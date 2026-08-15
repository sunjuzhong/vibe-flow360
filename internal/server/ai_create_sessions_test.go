package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestAICreateSessionSummaryIncludesProjectAndConversation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	now := time.Now().UTC()
	app := &Server{aiCreateSessions: map[string]aiCreateSession{
		"aic-session-test": {
			ID: "aic-session-test", Intent: "Create cylinder flow", FolderID: "folder-1", Phase: "completed",
			Prepared: &aiCreatePrepared{ProjectID: "prj-session", RootResourceID: "geo-session"}, DraftID: "draft-session",
			Messages:  []aiCreateSessionMessage{{Role: "user", Content: "Create cylinder flow", CreatedAt: now}},
			CreatedAt: now, UpdatedAt: now,
		},
	}}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	app.listAICreateSessions(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Sessions []aiCreateSessionSummary `json:"sessions"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Sessions) != 1 || body.Sessions[0].ProjectID != "prj-session" || body.Sessions[0].Messages[0].Content != "Create cylinder flow" {
		t.Fatalf("unexpected session summary: %#v", body.Sessions)
	}
}

func TestAICreateFollowUpKeepsGeometryCheckpointAndReopensParameters(t *testing.T) {
	now := time.Now().UTC()
	app := &Server{aiCreateSessions: map[string]aiCreateSession{
		"aic-follow-up": {
			ID: "aic-follow-up", Intent: "Create cylinder flow", FolderID: "folder-1", Phase: "completed",
			Prepared:   &aiCreatePrepared{ProjectID: "prj-existing", RootResourceID: "geo-existing"},
			Parameters: &aiCreateParameterCheckpoint{SimulationParams: json.RawMessage(`{"models":[]}`)}, DraftID: "draft-existing",
			CompletedAt: &now, CreatedAt: now, UpdatedAt: now,
		},
	}}
	session, err := app.advanceAICreateSession(aiCreateRequest{SessionID: "aic-follow-up", Intent: "Change the angle of attack to 8 degrees", FollowUp: true})
	if err != nil {
		t.Fatal(err)
	}
	if session.Prepared == nil || session.Prepared.ProjectID != "prj-existing" || session.Parameters != nil || session.CompletedAt != nil || session.DraftID != "" {
		t.Fatalf("follow-up did not preserve the Project checkpoint and reopen downstream design: %#v", session)
	}
	if len(session.Messages) != 1 || session.Messages[0].Role != "user" {
		t.Fatalf("follow-up conversation was not persisted: %#v", session.Messages)
	}
}
