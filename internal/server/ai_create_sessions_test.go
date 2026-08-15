package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
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

func TestAICreateSessionSummaryReconstructsLegacyHistoryAndCheckpoints(t *testing.T) {
	now := time.Now().UTC()
	session := aiCreateSession{
		ID: "aic-legacy", Intent: "Create a drop-body case", FolderID: "folder-legacy", Phase: "needs_input",
		Rounds: []aicreate.ClarificationRound{{
			Fields:  []aicreate.ClarificationField{{ID: "mach", Label: "Mach number", Type: "number", Unit: "", Required: true}},
			Answers: map[string]any{"mach": 0.8},
		}},
		Pending:    []aicreate.ClarificationField{{ID: "altitude", Label: "Flight altitude", Type: "number", Unit: "m", Required: true}},
		CAD:        &aiCreateCADCheckpoint{},
		Prepared:   &aiCreatePrepared{ProjectID: "prj-legacy", RootResourceID: "geo-legacy"},
		Parameters: &aiCreateParameterCheckpoint{},
		CreatedAt:  now, UpdatedAt: now,
	}

	summary := summarizeAICreateSession(session)
	if summary.OriginalRequest != session.Intent || len(summary.Messages) != 1 || summary.Messages[0].Content != session.Intent {
		t.Fatalf("legacy original request was not reconstructed: %#v", summary)
	}
	if len(summary.History) != 1 || summary.History[0].Fields[0].Label != "Mach number" || summary.History[0].Answers["mach"] != 0.8 {
		t.Fatalf("legacy clarification history was not exposed: %#v", summary.History)
	}
	if !summary.Checkpoints.CADValidated || !summary.Checkpoints.ProjectCreated || !summary.Checkpoints.ParametersValidated || summary.Checkpoints.DraftConfigured {
		t.Fatalf("unexpected checkpoint summary: %#v", summary.Checkpoints)
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
