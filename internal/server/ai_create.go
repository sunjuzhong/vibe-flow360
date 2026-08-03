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
	geometryPath := filepath.Join(stagingDir, "cylinder.step")
	geometryFile, err := os.OpenFile(geometryPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create generated geometry"})
		return
	}
	writeErr := aicreate.WriteCylinderSTEP(geometryFile, blueprint.Geometry)
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
		c.JSON(http.StatusBadGateway, gin.H{"error": humanizeAICreateProjectError(err)})
		return
	}
	normalized, err := s.normalizeAICreateResult(c.Request.Context(), rawResult, "geometry")
	if err != nil {
		projectID := findProjectIDFromRaw(rawResult)
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
	baseline, err := s.waitForAICreateSimulationParams(c.Request.Context(), remote.RootResourceID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":      "Project was created, but Flow360 did not finish preparing its simulation parameters",
			"project_id": remote.ProjectID,
		})
		return
	}
	completePatch, err := aicreate.CompleteSimulationPatch(baseline, blueprint.SimulationParams)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": err.Error(), "project_id": remote.ProjectID,
		})
		return
	}
	blueprint.SimulationParams = completePatch
	patch, err := json.Marshal(blueprint.SimulationParams)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not serialize generated parameters"})
		return
	}
	evidence := []plans.Evidence{
		{Key: "geometry.template", Value: blueprint.Template, Provenance: "derived", Description: "Procedural geometry selected from the user intent."},
		{Key: "geometry.diameter", Value: blueprint.Geometry.DiameterM, Provenance: "inferred", Description: "Cylinder diameter in metres."},
		{Key: "meshing.defaults.boundary_layer_first_layer_thickness", Value: 2.5e-5, Provenance: "derived", Description: "Wall-resolved cylinder-flow starting point in metres."},
		{Key: "models.Wall.entities", Value: "Geometry face groups", Provenance: "derived", Description: "Resolved from the imported CAD entity cache."},
		{Key: "operating_condition.velocity_magnitude", Value: 10, Provenance: "defaulted", Description: "Reviewable cylinder-flow template default."},
	}
	plan, err := s.plans.Create(plans.CreateInput{
		ProjectID: remote.ProjectID, ProjectName: blueprint.ProjectName,
		SourceID: remote.RootResourceID, SourceType: "Geometry", SourceName: "cylinder.step",
		Target: blueprint.Target, Name: "AI Create · Cylinder flow baseline", Intent: request.Intent,
		Patch: patch, Baseline: baseline, Evidence: evidence, ValidationHints: blueprint.Assumptions,
		IdempotencyKey: "ai-create:" + remote.ProjectID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "project was created, but its simulation plan could not be saved", "project_id": remote.ProjectID})
		return
	}
	plan = s.runPlanPreflight(c.Request.Context(), plan)
	if plan.Preflight == nil || !plan.Preflight.Valid {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":      "Project was created, but its generated parameters did not pass Flow360 schema preflight",
			"project_id": remote.ProjectID, "plan_id": plan.ID, "preflight": plan.Preflight,
		})
		return
	}

	c.JSON(http.StatusCreated, aiCreateResponse{
		ProjectID: remote.ProjectID, RootResourceID: remote.RootResourceID,
		RootResourceType: "Geometry", Blueprint: blueprint, Plan: plan,
		Stages: []string{"Interpreted requirement", "Generated exact CAD", "Created Flow360 Project", "Resolved CAD boundaries", "Loaded complete simulation parameters", "Passed Flow360 schema preflight"},
	})
}

const (
	aiCreateParamsLookupAttempts = 20
	aiCreateParamsLookupDelay    = 500 * time.Millisecond
)

func (s *Server) waitForAICreateSimulationParams(ctx context.Context, geometryID string) (json.RawMessage, error) {
	var lastErr error
	for attempt := 0; attempt < aiCreateParamsLookupAttempts; attempt++ {
		detail, err := s.flow360.ResourceDetail(ctx, "Geometry", geometryID)
		if err == nil && aiCreateSimulationParamsReady(detail.SimulationParams) {
			return detail.SimulationParams, nil
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = errors.New("Geometry SimulationParams are not available yet")
		}
		if attempt == aiCreateParamsLookupAttempts-1 {
			break
		}
		timer := time.NewTimer(aiCreateParamsLookupDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
}

func aiCreateSimulationParamsReady(raw json.RawMessage) bool {
	if len(raw) == 0 || !json.Valid(raw) {
		return false
	}
	var document map[string]any
	if json.Unmarshal(raw, &document) != nil {
		return false
	}
	if wrapped, ok := document["simulation_params"].(map[string]any); ok {
		document = wrapped
	}
	_, hasVersion := document["version"].(string)
	models, hasModels := document["models"].([]any)
	cache, hasCache := document["private_attribute_asset_cache"].(map[string]any)
	_, hasEntityInfo := cache["project_entity_info"].(map[string]any)
	return hasVersion && hasModels && len(models) > 0 && hasCache && hasEntityInfo
}

func validateAICreateAsset(path, sourceType string) error {
	extension := strings.ToLower(filepath.Ext(path))
	if strings.EqualFold(sourceType, "geometry") {
		switch extension {
		case ".step", ".stp", ".igs", ".iges", ".cax", ".catpart", ".catproduct":
		default:
			return fmt.Errorf("%s is a tessellated or unsupported asset; Flow360 Geometry requires a client-supported exact CAD format such as STEP or IGES", filepath.Base(path))
		}
		if extension == ".step" || extension == ".stp" {
			file, err := os.Open(path)
			if err != nil {
				return fmt.Errorf("read generated STEP: %w", err)
			}
			defer file.Close()
			preview, err := io.ReadAll(io.LimitReader(file, 256<<10))
			if err != nil {
				return fmt.Errorf("read generated STEP: %w", err)
			}
			upper := bytes.ToUpper(preview)
			if !bytes.Contains(upper, []byte("ISO-10303-21")) || !bytes.Contains(upper, []byte("CYLINDRICAL_SURFACE")) || bytes.Contains(upper, []byte("FACET_NORMAL")) {
				return fmt.Errorf("%s is not a validated analytic STEP B-rep", filepath.Base(path))
			}
		}
	}
	return nil
}

func humanizeAICreateProjectError(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "name resolution"), strings.Contains(message, "failed to resolve"), strings.Contains(message, "connection error"):
		return "Could not reach Flow360. Check the network connection and try again."
	case strings.Contains(message, "not a supported geometry"), strings.Contains(message, "not a supported geometry or surface mesh file"):
		return "The generated CAD format is not supported by the installed Flow360 client."
	case strings.Contains(message, "authentication"), strings.Contains(message, "unauthorized"), strings.Contains(message, "api key"):
		return "Flow360 authentication failed. Check the active profile and try again."
	default:
		return "Flow360 could not create the AI-generated Project. Check the service connection and try again."
	}
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
	projectID := findProjectIDFromRaw(raw)
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

func findProjectIDFromRaw(raw json.RawMessage) string {
	var data any
	if json.Unmarshal(raw, &data) != nil {
		return ""
	}
	if projectID := findStringField(data, map[string]bool{"project_id": true, "projectid": true}); projectID != "" {
		return projectID
	}
	return findTypedResourceID(data, "project")
}

func findTypedResourceIDFromRaw(raw json.RawMessage, expectedType string) string {
	var data any
	if json.Unmarshal(raw, &data) != nil {
		return ""
	}
	return findTypedResourceID(data, expectedType)
}
