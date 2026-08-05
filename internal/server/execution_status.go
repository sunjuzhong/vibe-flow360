package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

var executionSecretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)((?:FLOW360_APIKEY|VIBESIM_FLOW360_API_KEY)\s*[:=]\s*)[^\s"']+`),
	regexp.MustCompile(`(?i)(authorization\s*:\s*bearer\s+)[^\s"']+`),
}

type planExecutionSnapshot struct {
	Plan          plans.Plan     `json:"plan"`
	Phase         string         `json:"phase"`
	Progress      *float64       `json:"progress,omitempty"`
	ResourceType  string         `json:"resource_type,omitempty"`
	ResourceID    string         `json:"resource_id,omitempty"`
	RemoteState   string         `json:"remote_state,omitempty"`
	State         map[string]any `json:"state,omitempty"`
	Terminal      bool           `json:"terminal"`
	Logs          string         `json:"logs,omitempty"`
	LogsAvailable bool           `json:"logs_available"`
	StateError    string         `json:"state_error,omitempty"`
	LogsError     string         `json:"logs_error,omitempty"`
	RefreshedAt   time.Time      `json:"refreshed_at"`
}

func (s *Server) planExecution(c *gin.Context) {
	plan, err := s.plans.Get(c.Param("plan_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "plan not found"})
		return
	}
	tail, err := strconv.Atoi(c.DefaultQuery("tail", "120"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tail must be an integer"})
		return
	}
	if tail < 20 {
		tail = 20
	}
	if tail > 500 {
		tail = 500
	}

	snapshot := planExecutionSnapshot{Plan: plan, RefreshedAt: time.Now().UTC()}
	resourceType, resourceID, ok := planMonitorTarget(plan)
	if !ok {
		snapshot.Phase, snapshot.Terminal = executionPhase(plan.Status, "")
		snapshot.StateError = "Flow360 accepted the submission, but the response did not include a draft or output resource ID to monitor."
		c.JSON(http.StatusOK, snapshot)
		return
	}
	if snapshot.Plan.RemoteIDs == nil {
		recovered := plans.ExtractRemoteIDs(plan.Result)
		if recovered != nil {
			if recovered.ProjectID == "" {
				recovered.ProjectID = plan.ProjectID
			}
			if persisted, persistErr := s.plans.SetRemoteIDs(plan.ID, recovered); persistErr == nil {
				plan = persisted
				snapshot.Plan = persisted
			} else {
				snapshot.Plan.RemoteIDs = recovered
			}
		}
	}
	snapshot.ResourceType = resourceType
	snapshot.ResourceID = resourceID

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	var (
		stateRaw json.RawMessage
		logs     []byte
		stateErr error
		logsErr  error
		wait     sync.WaitGroup
	)
	wait.Add(2)
	go func() {
		defer wait.Done()
		stateRaw, stateErr = s.flow360.ResourceState(ctx, resourceType, resourceID)
	}()
	go func() {
		defer wait.Done()
		logs, logsErr = s.flow360.ResourceLogs(ctx, resourceType, resourceID, tail)
	}()
	wait.Wait()

	if stateErr != nil {
		snapshot.StateError = "Remote lifecycle state is temporarily unavailable."
	} else {
		_ = json.Unmarshal(stateRaw, &snapshot.State)
		snapshot.RemoteState = executionState(snapshot.State)
		snapshot.Progress = executionProgress(snapshot.State)
	}
	if logsErr != nil {
		snapshot.LogsError = "Flow360 logs are not available yet."
	} else {
		snapshot.LogsAvailable = true
		snapshot.Logs = redactExecutionLogs(string(logs))
	}
	snapshot.Phase, snapshot.Terminal = executionPhase(plan.Status, snapshot.RemoteState)
	if snapshot.Terminal {
		completeProgress := float64(100)
		snapshot.Progress = &completeProgress
		snapshot.Plan = s.reconcileTerminalExecution(snapshot.Plan, snapshot.RemoteState, snapshot.State)
	}
	c.JSON(http.StatusOK, snapshot)
}

func (s *Server) reconcileTerminalExecution(plan plans.Plan, remoteState string, state map[string]any) plans.Plan {
	if plan.Status == plans.StatusCompleted || plan.Status == plans.StatusFailed {
		return plan
	}
	if isSuccessState(remoteState) {
		updated, err := s.plans.MarkComplete(plan.ID, state)
		if err == nil {
			return updated
		}
	}
	if isFailureState(remoteState) {
		updated, err := s.plans.MarkFailed(plan.ID, errors.New("remote simulation ended with state: "+remoteState))
		if err == nil {
			return updated
		}
	}
	return plan
}

func redactExecutionLogs(logs string) string {
	for _, pattern := range executionSecretPatterns {
		logs = pattern.ReplaceAllString(logs, "${1}[REDACTED]")
	}
	return logs
}

func executionState(state map[string]any) string {
	return findLifecycleString(state)
}

func findLifecycleString(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"state", "status", "phase"} {
			if state, ok := typed[key].(string); ok && strings.TrimSpace(state) != "" {
				return state
			}
		}
		for _, key := range []string{"result", "data", "resource", "details"} {
			if state := findLifecycleString(typed[key]); state != "" {
				return state
			}
		}
	case []any:
		for _, item := range typed {
			if state := findLifecycleString(item); state != "" {
				return state
			}
		}
	}
	return ""
}

func executionProgress(state map[string]any) *float64 {
	for _, key := range []string{"progress_percent", "percent_complete", "percentage"} {
		if value, ok := state[key].(float64); ok && value >= 0 && value <= 100 {
			progress := value
			return &progress
		}
	}
	for _, key := range []string{"data", "resource", "details"} {
		if nested, ok := state[key].(map[string]any); ok {
			if progress := executionProgress(nested); progress != nil {
				return progress
			}
		}
	}
	return nil
}

func executionPhase(status, remoteState string) (string, bool) {
	if status == plans.StatusCompleted {
		return "Completed", true
	}
	if status == plans.StatusFailed {
		return "Failed", true
	}
	state := strings.ToLower(strings.TrimSpace(remoteState))
	switch state {
	case "completed", "processed", "success", "succeeded", "done":
		return "Completed", true
	case "failed", "error", "diverged", "cancelled", "canceled", "expired", "timed_out":
		return "Failed", true
	}
	switch {
	case strings.Contains(state, "post"), strings.Contains(state, "final"):
		return "Finalizing results", false
	case strings.Contains(state, "run"), strings.Contains(state, "solv"), strings.Contains(state, "process"):
		return "Running on Flow360", false
	case strings.Contains(state, "upload"), strings.Contains(state, "preprocess"), strings.Contains(state, "mesh"):
		return "Preparing remote resources", false
	case state == "pending":
		return "Pending on Flow360", false
	case state == "queued":
		return "Queued on Flow360", false
	case state != "":
		return "Flow360: " + remoteState, false
	case status == plans.StatusReconciling:
		return "Reconciling remote submission", false
	case status == plans.StatusSubmitted:
		return "Accepted by Flow360", false
	case status == plans.StatusRunning:
		return "Submitting to Flow360", false
	default:
		return "Waiting to start", false
	}
}
