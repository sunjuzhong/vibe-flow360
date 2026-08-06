package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
)

type createInterventionRequest struct {
	ProjectID    string           `json:"project_id"`
	ProjectName  string           `json:"project_name,omitempty"`
	ResourceID   string           `json:"resource_id,omitempty"`
	ResourceType string           `json:"resource_type,omitempty"`
	PlanID       string           `json:"plan_id,omitempty"`
	Target       string           `json:"target,omitempty"`
	Type         string           `json:"type"`
	Reason       string           `json:"reason"`
	Evidence     []agent.Evidence `json:"evidence,omitempty"`
	CurrentPatch json.RawMessage  `json:"current_patch,omitempty"`
}

type selectProposalRequest struct {
	ProposalID string `json:"proposal_id"`
	Feedback   string `json:"feedback,omitempty"`
}

type compileInterventionRequest struct {
	Feedback string `json:"feedback,omitempty"`
}

type interventionAnswersRequest struct {
	Answers map[string]any `json:"answers"`
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
	if interventions == nil {
		interventions = make([]agent.Intervention, 0)
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
		Target:       req.Target,
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

func (s *Server) submitInterventionAnswers(c *gin.Context) {
	var req interventionAnswersRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Answers == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clarification answers"})
		return
	}
	intervention, err := s.interventionEngine.SubmitClarification(c.Param("intervention_id"), req.Answers)
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

	intervention, err := s.interventionEngine.Get(c.Param("intervention_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	switch intervention.State {
	case agent.InterventionProposal:
		intervention, err = s.interventionEngine.SelectProposalAndAdvance(
			intervention.ID, req.ProposalID, req.Feedback,
		)
	case agent.InterventionUserFeedback, agent.InterventionPatchCompile, agent.InterventionValidation:
		if intervention.SelectedProposal == nil || intervention.SelectedProposal.ID != req.ProposalID {
			err = errors.New("another recovery proposal is already being applied")
		}
	case agent.InterventionResolved, agent.InterventionClosed:
		// Idempotent response for a stale browser click that raced the automatic
		// recovery cycle. Never expose an invalid transition after the repair is
		// already complete.
		c.JSON(http.StatusOK, intervention)
		return
	default:
		err = errors.New("the Agent is still preparing a repair proposal")
	}
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	// Selecting a repair authorizes only a local Plan edit. Compile the patch,
	// run the real Flow360 preflight, and return the reviewable repaired Plan in
	// one operation; remote execution still requires the normal Plan approval.
	if intervention.State == agent.InterventionUserFeedback {
		intervention, err = s.interventionEngine.RunEngineStep(intervention.ID)
	}
	if err == nil && intervention.State == agent.InterventionPatchCompile {
		intervention, err = s.interventionEngine.RunEngineStep(intervention.ID)
	}
	if err == nil && intervention.State == agent.InterventionValidation {
		intervention, err = s.validateAndApplyIntervention(intervention.ID)
	}
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "the Agent repair could not be compiled and validated: " + err.Error()})
		return
	}
	if intervention.State == agent.InterventionObservation {
		go s.runInterventionAutoCycle(intervention.ID)
	}
	c.JSON(http.StatusOK, intervention)
}

func (s *Server) compileInterventionPatch(c *gin.Context) {
	var req compileInterventionRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feedback request"})
			return
		}
	}
	intervention, err := s.interventionEngine.SetFeedbackAndCompile(
		c.Param("intervention_id"),
		req.Feedback,
	)
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
	if intervention.State != agent.InterventionValidation {
		c.JSON(http.StatusConflict, gin.H{"error": "intervention is not ready for validation"})
		return
	}
	intervention, err = s.validateAndApplyIntervention(intervention.ID)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, intervention)
}

func (s *Server) completeInterventionValidation(c *gin.Context) {
	// Compatibility endpoint: validation outcomes are always derived from the
	// real Flow360 preflight. A browser cannot mark its own proposal valid.
	intervention, err := s.validateAndApplyIntervention(c.Param("intervention_id"))
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
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
