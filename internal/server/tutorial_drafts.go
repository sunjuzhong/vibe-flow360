package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

type createConfiguredDraftRequest struct {
	SourceID         string          `json:"source_id"`
	Name             string          `json:"name"`
	Patch            json.RawMessage `json:"patch"`
	SimulationParams json.RawMessage `json:"simulation_params"`
}

func (s *Server) createConfiguredFlow360Draft(c *gin.Context) {
	projectID := strings.TrimSpace(c.Param("project_id"))
	if !validFlow360ProjectID(projectID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxDraftParametersRequestBytes)
	var request createConfiguredDraftRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid configured Draft request"})
		return
	}
	request.SourceID = strings.TrimSpace(request.SourceID)
	request.Name = strings.TrimSpace(request.Name)
	if request.SourceID == "" || request.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Draft source and name are required"})
		return
	}
	var patchObject map[string]any
	var paramsObject map[string]any
	if len(request.SimulationParams) > 0 {
		if json.Unmarshal(request.SimulationParams, &paramsObject) != nil || paramsObject == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Draft SimulationParams must be a JSON object"})
			return
		}
	} else if json.Unmarshal(request.Patch, &patchObject) != nil || patchObject == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Draft patch must be a JSON object"})
		return
	}

	// This endpoint represents an intentional user creation. Unlike recovery
	// flows, it must allow multiple Drafts based on the same source Resource.
	created, err := s.flow360.CreateDraft(c.Request.Context(), request.SourceID, request.Name)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 could not create the configured Draft"})
		return
	}
	remoteIDs := plans.ExtractRemoteIDs(created)
	if remoteIDs == nil || strings.TrimSpace(remoteIDs.DraftID) == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 did not return the configured Draft ID"})
		return
	}
	draftID := remoteIDs.DraftID
	detail, err := s.flow360.ResourceDetail(c.Request.Context(), "Draft", draftID)
	if err != nil || len(detail.SimulationParams) == 0 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Draft was created but its SimulationParams are unavailable", "draft_id": draftID})
		return
	}
	configured := request.SimulationParams
	if len(configured) == 0 {
		configured, err = plans.MergeSimulationParams(detail.SimulationParams, request.Patch)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "draft_id": draftID})
			return
		}
	}
	canonical, err := s.flow360.SetDraftSimulationParams(c.Request.Context(), draftID, configured)
	if err != nil {
		canonical, err = s.flow360.SetDraftSimulationParams(c.Request.Context(), draftID, configured)
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Draft was created but Flow360 did not accept its parameters", "draft_id": draftID})
		return
	}
	if !json.Valid(canonical) {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 returned invalid canonical Draft parameters", "draft_id": draftID})
		return
	}
	canonical, err = plans.MergeSimulationParams(canonical, json.RawMessage(`{}`))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 returned invalid canonical Draft parameters", "draft_id": draftID})
		return
	}
	var canonicalValue any
	if err := json.Unmarshal(canonical, &canonicalValue); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode canonical Draft parameters"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": draftID, "name": request.Name, "project_id": projectID, "source_id": request.SourceID, "simulation_params": canonicalValue})
}
