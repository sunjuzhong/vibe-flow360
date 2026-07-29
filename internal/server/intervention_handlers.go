package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sjzsdu/vibesim/internal/agent"
)

type createInterventionRequest struct {
	ProjectID    string          `json:"project_id"`
	ProjectName  string          `json:"project_name,omitempty"`
	ResourceID   string          `json:"resource_id,omitempty"`
	ResourceType string          `json:"resource_type,omitempty"`
	PlanID       string          `json:"plan_id,omitempty"`
	Type         string          `json:"type"`
	Reason       string          `json:"reason"`
	Evidence     []agent.Evidence `json:"evidence,omitempty"`
	CurrentPatch json.RawMessage `json:"current_patch,omitempty"`
}

type selectProposalRequest struct {
	ProposalID string `json:"proposal_id"`
	Feedback   string `json:"feedback,omitempty"`
}

type completeValidationRequest struct {
	Valid   bool     `json:"valid"`
	Errors  []string `json:"errors,omitempty"`
}

func (s *Server) listInterventions(c *gin.Context) {
	projectID := strings.TrimSpace(c.Query("project_id"))
	resourceID := strings.TrimSpace(c.Query("resource_id"))
	state := strings.TrimSpace(c.Query("state"))

	interventions, err := s.interventionEngine.List(projectID, resourceID, state)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"interventions": interventions})
}

func (s *Server) getIntervention(c *gin.Context) {
	intervention, err := s.interventionEngine.Get(c.Param("intervention_id"))
	if err != nil {
		if errors.Is(err, agent.ErrInterventionNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intervention)
}

func (s *Server) createIntervention(c *gin.Context) {
	var req createInterventionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if !agent.ValidType(req.Type) {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid intervention type: %s", req.Type)})
		return
	}

	input := agent.InterventionInput{
		ProjectID:    req.ProjectID,
		ProjectName:  req.ProjectName,
		ResourceID:   req.ResourceID,
		ResourceType: req.ResourceType,
		PlanID:       req.PlanID,
		Type:         req.Type,
		Reason:       req.Reason,
		Evidence:     req.Evidence,
		CurrentPatch: req.CurrentPatch,
	}

	intervention, err := agent.NewIntervention(input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	created, err := s.interventions.Create(intervention)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, created)
}

func (s *Server) runInterventionDiagnosis(c *gin.Context) {
	intervention, err := s.interventionEngine.RunEngineStep(c.Param("intervention_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intervention)
}

func (s *Server) generateInterventionProposals(c *gin.Context) {
	intervention, err := s.interventionEngine.RunEngineStep(c.Param("intervention_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intervention)
}

func (s *Server) selectInterventionProposal(c *gin.Context) {
	var req selectProposalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	intervention, err := s.interventionEngine.SelectProposalAndAdvance(
		c.Param("intervention_id"),
		req.ProposalID,
		req.Feedback,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intervention)
}

func (s *Server) compileInterventionPatch(c *gin.Context) {
	intervention, err := s.interventionEngine.RunEngineStep(c.Param("intervention_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intervention)
}

func (s *Server) validateIntervention(c *gin.Context) {
	intervention, err := s.interventionEngine.RunEngineStep(c.Param("intervention_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intervention)
}

func (s *Server) completeInterventionValidation(c *gin.Context) {
	var req completeValidationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	intervention, err := s.interventionEngine.CompleteValidation(
		c.Param("intervention_id"),
		req.Valid,
		req.Errors,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intervention)
}

func (s *Server) closeIntervention(c *gin.Context) {
	intervention, err := s.interventionEngine.Close(c.Param("intervention_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intervention)
}
