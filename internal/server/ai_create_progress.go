package server

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const aiCreateProgressTTL = time.Hour

var aiCreateProgressIDPattern = regexp.MustCompile(`^aip-[A-Za-z0-9-]{12,80}$`)

var aiCreateProgressStages = []string{
	"Interpreting the engineering goal and designing CAD",
	"Generating and validating exact STEP geometry",
	"Creating and processing the Flow360 Project",
	"Loading canonical Flow360 parameters and schemas",
	"Generating and preflighting the simulation setup",
	"Creating and configuring the Flow360 Draft",
}

type aiCreateProgress struct {
	RequestID  string          `json:"request_id"`
	Status     string          `json:"status"`
	Stage      int             `json:"stage"`
	Stages     []string        `json:"stages"`
	Detail     string          `json:"detail,omitempty"`
	ProjectID  string          `json:"project_id,omitempty"`
	ResourceID string          `json:"resource_id,omitempty"`
	SessionID  string          `json:"session_id,omitempty"`
	Response   json.RawMessage `json:"response,omitempty"`
	StartedAt  time.Time       `json:"started_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

func (s *Server) startAICreateProgress(requestID string) bool {
	requestID = strings.TrimSpace(requestID)
	if !aiCreateProgressIDPattern.MatchString(requestID) {
		return false
	}
	now := time.Now().UTC()
	s.aiCreateProgressMu.Lock()
	defer s.aiCreateProgressMu.Unlock()
	if s.aiCreateProgress == nil {
		s.aiCreateProgress = map[string]aiCreateProgress{}
	}
	for id, item := range s.aiCreateProgress {
		if now.Sub(item.UpdatedAt) > aiCreateProgressTTL {
			delete(s.aiCreateProgress, id)
		}
	}
	s.aiCreateProgress[requestID] = aiCreateProgress{
		RequestID: requestID, Status: "running", Stage: 0,
		Stages:    append([]string(nil), aiCreateProgressStages...),
		Detail:    "The Agent is reading the request and deciding the exact CAD construction.",
		StartedAt: now, UpdatedAt: now,
	}
	s.persistAICreateProgressLocked()
	return true
}

func (s *Server) updateAICreateProgress(requestID string, stage int, detail string) {
	if requestID == "" {
		return
	}
	s.aiCreateProgressMu.Lock()
	defer s.aiCreateProgressMu.Unlock()
	item, ok := s.aiCreateProgress[requestID]
	if !ok || item.Status != "running" {
		return
	}
	if stage >= item.Stage && stage < len(item.Stages) {
		item.Stage = stage
	}
	item.Detail = strings.TrimSpace(detail)
	item.UpdatedAt = time.Now().UTC()
	s.aiCreateProgress[requestID] = item
	s.persistAICreateProgressLocked()
}

func (s *Server) finishAICreateProgress(requestID, status, detail, projectID, resourceID string) {
	if requestID == "" {
		return
	}
	s.aiCreateProgressMu.Lock()
	defer s.aiCreateProgressMu.Unlock()
	item, ok := s.aiCreateProgress[requestID]
	if !ok {
		return
	}
	item.Status = status
	item.Detail = strings.TrimSpace(detail)
	if projectID = strings.TrimSpace(projectID); projectID != "" {
		item.ProjectID = projectID
	}
	if resourceID = strings.TrimSpace(resourceID); resourceID != "" {
		item.ResourceID = resourceID
	}
	if status == "completed" {
		item.Stage = len(item.Stages)
	}
	item.UpdatedAt = time.Now().UTC()
	s.aiCreateProgress[requestID] = item
	s.persistAICreateProgressLocked()
}

func (s *Server) failAICreateProgressIfRunning(requestID, detail string) {
	if requestID == "" {
		return
	}
	s.aiCreateProgressMu.Lock()
	defer s.aiCreateProgressMu.Unlock()
	item, ok := s.aiCreateProgress[requestID]
	if !ok || item.Status != "running" {
		return
	}
	item.Status = "failed"
	item.Detail = strings.TrimSpace(detail)
	item.UpdatedAt = time.Now().UTC()
	s.aiCreateProgress[requestID] = item
	s.persistAICreateProgressLocked()
}

func (s *Server) bindAICreateProgressResources(requestID, projectID, resourceID string) {
	if requestID == "" {
		return
	}
	s.aiCreateProgressMu.Lock()
	defer s.aiCreateProgressMu.Unlock()
	item, ok := s.aiCreateProgress[requestID]
	if !ok {
		return
	}
	if projectID = strings.TrimSpace(projectID); projectID != "" {
		item.ProjectID = projectID
	}
	if resourceID = strings.TrimSpace(resourceID); resourceID != "" {
		item.ResourceID = resourceID
	}
	item.UpdatedAt = time.Now().UTC()
	s.aiCreateProgress[requestID] = item
	s.persistAICreateProgressLocked()
}

func (s *Server) bindAICreateProgressSession(requestID, sessionID string) {
	if requestID == "" || strings.TrimSpace(sessionID) == "" {
		return
	}
	s.aiCreateProgressMu.Lock()
	defer s.aiCreateProgressMu.Unlock()
	item, ok := s.aiCreateProgress[requestID]
	if !ok {
		return
	}
	item.SessionID = strings.TrimSpace(sessionID)
	item.UpdatedAt = time.Now().UTC()
	s.aiCreateProgress[requestID] = item
	s.persistAICreateProgressLocked()
}

func (s *Server) storeAICreateProgressResponse(requestID string, response any) {
	if requestID == "" {
		return
	}
	payload, err := json.Marshal(response)
	if err != nil {
		return
	}
	s.aiCreateProgressMu.Lock()
	defer s.aiCreateProgressMu.Unlock()
	item, ok := s.aiCreateProgress[requestID]
	if !ok {
		return
	}
	item.Response = payload
	item.UpdatedAt = time.Now().UTC()
	s.aiCreateProgress[requestID] = item
	s.persistAICreateProgressLocked()
}

func (s *Server) aiCreateProgressStatus(c *gin.Context) {
	requestID := strings.TrimSpace(c.Param("request_id"))
	s.aiCreateProgressMu.Lock()
	item, ok := s.aiCreateProgress[requestID]
	s.aiCreateProgressMu.Unlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "AI Create progress is not available"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func aiCreateProgressID(c *gin.Context) string {
	value, _ := c.Get("ai_create_progress_id")
	requestID, _ := value.(string)
	return requestID
}
