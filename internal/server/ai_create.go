package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
	geometryPath := filepath.Join(stagingDir, "cylinder.stl")
	geometryFile, err := os.OpenFile(geometryPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create generated geometry"})
		return
	}
	writeErr := aicreate.WriteCylinderSTL(geometryFile, blueprint.Geometry)
	closeErr := geometryFile.Close()
	if writeErr != nil || closeErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not write generated geometry"})
		return
	}

	rawResult, err := s.flow360.CreateProject(
		c.Request.Context(), []string{geometryPath}, "geometry", blueprint.ProjectName,
		"m", "standard", "", request.FolderID, []string{"ai-create", blueprint.Template},
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 did not accept the AI-created project"})
		return
	}
	normalized, err := normalizeImportResult(rawResult, "geometry")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
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
		SourceID: remote.RootResourceID, SourceType: "Geometry", SourceName: "cylinder.stl",
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
