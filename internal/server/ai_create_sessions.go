package server

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
)

func summarizeAICreateSession(session aiCreateSession) aiCreateSessionSummary {
	summary := aiCreateSessionSummary{
		ID: session.ID, Intent: session.Intent, FolderID: session.FolderID, Phase: session.Phase,
		DraftID: session.DraftID, Round: len(session.Rounds) + 1, Messages: append([]aiCreateSessionMessage(nil), session.Messages...),
		Pending: append([]aicreate.ClarificationField(nil), session.Pending...), LastError: session.LastError,
		CreatedAt: session.CreatedAt, UpdatedAt: session.UpdatedAt, CompletedAt: session.CompletedAt,
	}
	if session.Prepared != nil {
		summary.ProjectID = session.Prepared.ProjectID
		summary.RootResourceID = session.Prepared.RootResourceID
	}
	return summary
}

func (s *Server) listAICreateSessions(c *gin.Context) {
	s.aiCreateMu.Lock()
	items := make([]aiCreateSessionSummary, 0, len(s.aiCreateSessions))
	for _, session := range s.aiCreateSessions {
		items = append(items, summarizeAICreateSession(session))
	}
	s.aiCreateMu.Unlock()
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	c.JSON(http.StatusOK, gin.H{"sessions": items})
}

func (s *Server) getAICreateSession(c *gin.Context) {
	id := strings.TrimSpace(c.Param("session_id"))
	s.aiCreateMu.Lock()
	session, ok := s.aiCreateSessions[id]
	s.aiCreateMu.Unlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "AI Create session was not found"})
		return
	}
	c.JSON(http.StatusOK, summarizeAICreateSession(session))
}
