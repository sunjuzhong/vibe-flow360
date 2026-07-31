package server

import (
	"context"
	"encoding/json"
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
	Progress      int            `json:"progress"`
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
		snapshot.Phase, snapshot.Progress, snapshot.Terminal = executionPhase(plan.Status, "")
		c.JSON(http.StatusOK, snapshot)
		return
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
	}
	if logsErr != nil {
		snapshot.LogsError = "Flow360 logs are not available yet."
	} else {
		snapshot.LogsAvailable = true
		snapshot.Logs = redactExecutionLogs(string(logs))
	}
	snapshot.Phase, snapshot.Progress, snapshot.Terminal = executionPhase(plan.Status, snapshot.RemoteState)
	c.JSON(http.StatusOK, snapshot)
}

func redactExecutionLogs(logs string) string {
	for _, pattern := range executionSecretPatterns {
		logs = pattern.ReplaceAllString(logs, "${1}[REDACTED]")
	}
	return logs
}

func executionState(state map[string]any) string {
	for _, key := range []string{"state", "status", "phase", "result"} {
		if value, ok := state[key].(string); ok {
			return value
		}
	}
	return ""
}

func executionPhase(status, remoteState string) (string, int, bool) {
	if status == plans.StatusCompleted {
		return "Completed", 100, true
	}
	if status == plans.StatusFailed {
		return "Failed", 100, true
	}
	state := strings.ToLower(strings.TrimSpace(remoteState))
	switch state {
	case "completed", "processed", "success", "succeeded", "done":
		return "Completed", 100, true
	case "failed", "error", "diverged", "cancelled", "canceled", "expired", "timed_out":
		return "Failed", 100, true
	}
	switch {
	case strings.Contains(state, "post"), strings.Contains(state, "final"):
		return "Finalizing results", 88, false
	case strings.Contains(state, "run"), strings.Contains(state, "solv"), strings.Contains(state, "process"):
		return "Running on Flow360", 68, false
	case strings.Contains(state, "upload"), strings.Contains(state, "preprocess"), strings.Contains(state, "mesh"):
		return "Preparing remote resources", 48, false
	case state != "":
		return "Queued on Flow360", 38, false
	case status == plans.StatusReconciling:
		return "Reconciling remote submission", 25, false
	case status == plans.StatusSubmitted:
		return "Accepted by Flow360", 35, false
	case status == plans.StatusRunning:
		return "Submitting to Flow360", 15, false
	default:
		return "Waiting to start", 0, false
	}
}
