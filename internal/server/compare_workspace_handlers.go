package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/compareworkspace"
)

type createCompareWorkspaceRequest struct {
	Name         string                         `json:"name"`
	Participants []compareworkspace.Participant `json:"participants"`
	ViewState    json.RawMessage                `json:"view_state,omitempty"`
}

func (s *Server) createCompareWorkspace(c *gin.Context) {
	if s.compareWorkspaces == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "compare workspace storage is unavailable"})
		return
	}
	var req createCompareWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	caseIDs := make([]string, 0, len(req.Participants))
	for _, participant := range req.Participants {
		caseIDs = append(caseIDs, participant.CaseID)
	}
	if len(caseIDs) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least two participants are required"})
		return
	}
	snapshot, err := s.buildCaseComparison(c.Request.Context(), compareRequest{CaseIDs: caseIDs, Baseline: caseIDs[0]})
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "comparison evidence could not be captured: " + err.Error()})
		return
	}
	for index := range req.Participants {
		if index < len(snapshot.Cases) {
			req.Participants[index].CaseNameSnapshot = snapshot.Cases[index].Name
		}
	}
	workspace, err := s.compareWorkspaces.Create(compareworkspace.CreateInput{
		Name: req.Name, Participants: req.Participants, Snapshot: snapshot, ViewState: req.ViewState,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, workspace)
}

func (s *Server) listCompareWorkspaces(c *gin.Context) {
	if s.compareWorkspaces == nil {
		c.JSON(http.StatusOK, gin.H{"workspaces": []any{}})
		return
	}
	workspaces, err := s.compareWorkspaces.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	type summary struct {
		ID           string                         `json:"id"`
		Name         string                         `json:"name"`
		Status       string                         `json:"status"`
		Participants []compareworkspace.Participant `json:"participants"`
		UpdatedAt    time.Time                      `json:"updated_at"`
	}
	result := make([]summary, 0, len(workspaces))
	for _, workspace := range workspaces {
		result = append(result, summary{
			ID: workspace.ID, Name: workspace.Name, Status: workspace.Status,
			Participants: workspace.Participants, UpdatedAt: workspace.UpdatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"workspaces": result})
}

func (s *Server) getCompareWorkspace(c *gin.Context) {
	if s.compareWorkspaces == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "compare workspace storage is unavailable"})
		return
	}
	workspace, err := s.compareWorkspaces.Get(c.Param("compare_id"))
	if errors.Is(err, compareworkspace.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Availability is live, while names and evidence remain immutable snapshots.
	for index := range workspace.Participants {
		participant := &workspace.Participants[index]
		detail, detailErr := s.flow360.ResourceDetail(c.Request.Context(), "Case", participant.CaseID)
		if detailErr != nil {
			message := strings.ToLower(detailErr.Error())
			if strings.Contains(message, "unauthorized") || strings.Contains(message, "forbidden") || strings.Contains(message, "401") || strings.Contains(message, "403") {
				participant.Availability = "inaccessible"
			} else {
				participant.Availability = "unavailable"
			}
		} else if _, infoUnavailable := detail.Errors["info"]; infoUnavailable {
			participant.Availability = "unavailable"
		} else {
			participant.Availability = "available"
		}
	}
	c.JSON(http.StatusOK, workspace)
}

func (s *Server) updateCompareWorkspaceViewState(c *gin.Context) {
	if s.compareWorkspaces == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "compare workspace storage is unavailable"})
		return
	}
	var req struct {
		ViewState json.RawMessage `json:"view_state"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	workspace, err := s.compareWorkspaces.UpdateViewState(c.Param("compare_id"), req.ViewState)
	if errors.Is(err, compareworkspace.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, workspace)
}

func (s *Server) appendCompareWorkspaceAISession(c *gin.Context) {
	if s.compareWorkspaces == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "compare workspace storage is unavailable"})
		return
	}
	var session compareworkspace.AISession
	if err := c.ShouldBindJSON(&session); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	workspace, err := s.compareWorkspaces.AppendAISession(c.Param("compare_id"), session)
	if errors.Is(err, compareworkspace.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, workspace.AISessions[len(workspace.AISessions)-1])
}

func (s *Server) updateCompareWorkspaceStatus(c *gin.Context) {
	if s.compareWorkspaces == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "compare workspace storage is unavailable"})
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	workspace, err := s.compareWorkspaces.SetStatus(c.Param("compare_id"), req.Status)
	if errors.Is(err, compareworkspace.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, workspace)
}

func (s *Server) duplicateCompareWorkspace(c *gin.Context) {
	if s.compareWorkspaces == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "compare workspace storage is unavailable"})
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	workspace, err := s.compareWorkspaces.Duplicate(c.Param("compare_id"), req.Name)
	if errors.Is(err, compareworkspace.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, workspace)
}

func (s *Server) deleteCompareWorkspace(c *gin.Context) {
	if s.compareWorkspaces == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "compare workspace storage is unavailable"})
		return
	}
	if err := s.compareWorkspaces.Delete(c.Param("compare_id")); errors.Is(err, compareworkspace.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	} else if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
