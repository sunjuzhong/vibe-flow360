package server

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
)

func summarizeAICreateSession(session aiCreateSession) aiCreateSessionSummary {
	originalRequest := strings.TrimSpace(strings.SplitN(session.Intent, "\n\nFollow-up request:", 2)[0])
	if len(session.Messages) > 0 && session.Messages[0].Role == "user" && strings.TrimSpace(session.Messages[0].Content) != "" {
		originalRequest = strings.TrimSpace(session.Messages[0].Content)
	}
	messages := append([]aiCreateSessionMessage(nil), session.Messages...)
	if len(messages) == 0 || messages[0].Role != "user" || strings.TrimSpace(messages[0].Content) != originalRequest {
		messages = append([]aiCreateSessionMessage{{Role: "user", Content: originalRequest, CreatedAt: session.CreatedAt}}, messages...)
	}
	history := make([]aiCreateHistoryRound, 0, len(session.Rounds))
	for index, round := range session.Rounds {
		history = append(history, aiCreateHistoryRound{
			Round: index + 1, Fields: append([]aicreate.ClarificationField(nil), round.Fields...),
			Answers: cloneAICreateAnswers(round.Answers),
		})
	}
	summary := aiCreateSessionSummary{
		ID: session.ID, Intent: session.Intent, OriginalRequest: originalRequest, FolderID: session.FolderID, Phase: session.Phase,
		DraftID: session.DraftID, Round: len(session.Rounds) + 1, Messages: messages, History: history,
		Checkpoints: aiCreateCheckpointSummary{
			CADValidated: session.CAD != nil, ProjectCreated: session.Prepared != nil,
			ParametersValidated: session.Parameters != nil, DraftConfigured: session.DraftID != "",
		},
		Pending: append([]aicreate.ClarificationField(nil), session.Pending...), LastError: session.LastError,
		CreatedAt: session.CreatedAt, UpdatedAt: session.UpdatedAt, CompletedAt: session.CompletedAt,
	}
	if session.Prepared != nil {
		summary.ProjectID = session.Prepared.ProjectID
		summary.RootResourceID = session.Prepared.RootResourceID
	}
	return summary
}

func cloneAICreateAnswers(answers map[string]any) map[string]any {
	if answers == nil {
		return nil
	}
	cloned := make(map[string]any, len(answers))
	for key, value := range answers {
		cloned[key] = value
	}
	return cloned
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
