package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

const maxAICreateIntentBytes = 4000

type aiCreateRequest struct {
	Intent   string `json:"intent"`
	FolderID string `json:"folder_id"`
}

type aiCreateResponse struct {
	ProjectID        string             `json:"project_id"`
	RootResourceID   string             `json:"root_resource_id"`
	RootResourceType string             `json:"root_resource_type"`
	Blueprint        aicreate.Blueprint `json:"blueprint"`
	Plan             plans.Plan         `json:"plan"`
	Stages           []string           `json:"stages"`
}

func (s *Server) aiCreateProject(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAICreateIntentBytes+1024)
	var request aiCreateRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "simulation requirement is too large"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid AI Create request"})
		return
	}
	request.Intent = strings.TrimSpace(request.Intent)
	request.FolderID = strings.TrimSpace(request.FolderID)
	if len(request.Intent) > maxAICreateIntentBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "simulation requirement is too large"})
		return
	}
	if request.FolderID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "select a destination folder before creating a project"})
		return
	}

	blueprint, err := aicreate.FromIntent(request.Intent)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	stagingRoot := filepath.Join(s.workDir, "ai-create")
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare generated geometry"})
		return
	}
	stagingDir, err := os.MkdirTemp(stagingRoot, "cylinder-")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare generated geometry"})
		return
	}
	defer os.RemoveAll(stagingDir)
	geometryPath := filepath.Join(stagingDir, "cylinder.brep")
	geometryFile, err := os.OpenFile(geometryPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create generated geometry"})
		return
	}
	writeErr := aicreate.WriteCylinderBREP(geometryFile, blueprint.Geometry)
	closeErr := geometryFile.Close()
	if writeErr != nil || closeErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not write generated geometry"})
		return
	}
	if err := validateAICreateAsset(geometryPath, "geometry"); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	rawResult, err := s.flow360.CreateProjectSync(
		c.Request.Context(), []string{geometryPath}, "geometry", blueprint.ProjectName,
		"m", "standard", "", request.FolderID, []string{"ai-create", blueprint.Template},
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 did not accept the AI-created project"})
		return
	}
	normalized, err := s.normalizeAICreateResult(c.Request.Context(), rawResult, "geometry")
	if err != nil {
		projectID := findStringFieldFromRaw(rawResult, map[string]bool{"project_id": true, "projectid": true})
		payload := gin.H{"error": err.Error()}
		if projectID != "" {
			payload["project_id"] = projectID
		}
		c.JSON(http.StatusBadGateway, payload)
		return
	}
	var remote struct {
		ProjectID      string `json:"project_id"`
		RootResourceID string `json:"root_resource_id"`
	}
	if err := json.Unmarshal(normalized, &remote); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not read the AI-created project result"})
		return
	}
	patch, err := json.Marshal(blueprint.SimulationParams)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not serialize generated parameters"})
		return
	}
	evidence := []plans.Evidence{
		{Key: "geometry.template", Value: blueprint.Template, Provenance: "derived", Description: "Procedural geometry selected from the user intent."},
		{Key: "geometry.diameter", Value: blueprint.Geometry.DiameterM, Provenance: "inferred", Description: "Cylinder diameter in metres."},
		{Key: "operating_condition.velocity_magnitude", Value: 10, Provenance: "defaulted", Description: "Reviewable cylinder-flow template default."},
	}
	plan, err := s.plans.Create(plans.CreateInput{
		ProjectID: remote.ProjectID, ProjectName: blueprint.ProjectName,
		SourceID: remote.RootResourceID, SourceType: "Geometry", SourceName: "cylinder.brep",
		Target: blueprint.Target, Name: "AI Create · Cylinder flow baseline", Intent: request.Intent,
		Patch: patch, Evidence: evidence, ValidationHints: blueprint.Assumptions,
		IdempotencyKey: "ai-create:" + remote.ProjectID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "project was created, but its simulation plan could not be saved", "project_id": remote.ProjectID})
		return
	}

	c.JSON(http.StatusCreated, aiCreateResponse{
		ProjectID: remote.ProjectID, RootResourceID: remote.RootResourceID,
		RootResourceType: "Geometry", Blueprint: blueprint, Plan: plan,
		Stages: []string{"Interpreted requirement", "Generated cylinder geometry", "Created Flow360 Project", "Loaded simulation plan"},
	})
}

func validateAICreateAsset(path, sourceType string) error {
	extension := strings.ToLower(filepath.Ext(path))
	if strings.EqualFold(sourceType, "geometry") {
		switch extension {
		case ".step", ".stp", ".igs", ".iges", ".brep", ".cax", ".catpart", ".catproduct":
		default:
			return fmt.Errorf("%s is a tessellated or unsupported asset; Flow360 Geometry requires STEP, IGES, BREP, CAX, or CATIA CAD", filepath.Base(path))
		}
		if extension == ".brep" {
			file, err := os.Open(path)
			if err != nil {
				return fmt.Errorf("read generated BREP: %w", err)
			}
			defer file.Close()
			preview, err := io.ReadAll(io.LimitReader(file, 256<<10))
			if err != nil {
				return fmt.Errorf("read generated BREP: %w", err)
			}
			if !bytes.Contains(preview, []byte("CASCADE Topology")) || !bytes.Contains(preview, []byte("Surfaces")) || bytes.Contains(bytes.ToLower(preview), []byte("facet normal")) {
				return fmt.Errorf("%s is not a validated analytic OpenCascade BREP", filepath.Base(path))
			}
		}
	}
	return nil
}

const (
	aiCreateRootLookupAttempts = 8
	aiCreateRootLookupDelay    = 350 * time.Millisecond
)

func (s *Server) normalizeAICreateResult(ctx context.Context, raw json.RawMessage, sourceType string) (json.RawMessage, error) {
	return normalizeAICreateResultWithLookup(
		ctx, raw, sourceType, s.flow360.ProjectItems,
		aiCreateRootLookupAttempts, aiCreateRootLookupDelay,
	)
}

func normalizeAICreateResultWithLookup(
	ctx context.Context,
	raw json.RawMessage,
	sourceType string,
	lookup func(context.Context, string) (json.RawMessage, error),
	attempts int,
	delay time.Duration,
) (json.RawMessage, error) {
	normalized, err := normalizeImportResult(raw, sourceType)
	if err == nil {
		return normalized, nil
	}
	projectID := findStringFieldFromRaw(raw, map[string]bool{"project_id": true, "projectid": true})
	if projectID == "" {
		return nil, err
	}
	expectedType := strings.ReplaceAll(strings.ToLower(sourceType), "-", "")
	var lastErr error
	if attempts < 1 {
		attempts = 1
	}
	for attempt := 0; attempt < attempts; attempt++ {
		items, itemsErr := lookup(ctx, projectID)
		if itemsErr == nil {
			if rootID := findTypedResourceIDFromRaw(items, expectedType); rootID != "" {
				var flowResult any
				if json.Unmarshal(raw, &flowResult) != nil {
					flowResult = map[string]any{"raw": string(raw)}
				}
				return json.Marshal(map[string]any{
					"project_id": projectID, "root_resource_id": rootID,
					"root_resource_type": sourceType, "flow360_result": flowResult,
				})
			}
			lastErr = errors.New("root resource is not visible in the Project yet")
		} else {
			lastErr = itemsErr
		}
		if attempt == attempts-1 {
			break
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, fmt.Errorf("Project %s was created, but its root resource is not available yet: %w", projectID, lastErr)
}

func findStringFieldFromRaw(raw json.RawMessage, keys map[string]bool) string {
	var data any
	if json.Unmarshal(raw, &data) != nil {
		return ""
	}
	return findStringField(data, keys)
}

func findTypedResourceIDFromRaw(raw json.RawMessage, expectedType string) string {
	var data any
	if json.Unmarshal(raw, &data) != nil {
		return ""
	}
	return findTypedResourceID(data, expectedType)
}
