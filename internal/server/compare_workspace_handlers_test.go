package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/compareworkspace"
	"github.com/sunjuzhong/vibe-flow360/internal/comparison"
)

func TestCompareWorkspaceStateAndAISessionRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store, err := compareworkspace.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := store.Create(compareworkspace.CreateInput{
		Name: "Saved comparison",
		Participants: []compareworkspace.Participant{
			{ProjectID: "prj-a", CaseID: "case-a", CaseNameSnapshot: "A"},
			{ProjectID: "prj-a", CaseID: "case-b", CaseNameSnapshot: "B"},
		},
		Snapshot: comparison.CompareResult{},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{compareWorkspaces: store}
	router := gin.New()
	router.GET("/api/compare-workspaces", app.listCompareWorkspaces)
	router.PUT("/api/compare-workspaces/:compare_id/view-state", app.updateCompareWorkspaceViewState)
	router.POST("/api/compare-workspaces/:compare_id/ai-sessions", app.appendCompareWorkspaceAISession)
	router.POST("/api/compare-workspaces/:compare_id/analyze", app.analyzeCompareWorkspaceRevision)

	list := httptest.NewRecorder()
	router.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/api/compare-workspaces", nil))
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), workspace.ID) {
		t.Fatalf("unexpected list response: %d %s", list.Code, list.Body.String())
	}

	view := httptest.NewRecorder()
	router.ServeHTTP(view, httptest.NewRequest(http.MethodPut, "/api/compare-workspaces/"+workspace.ID+"/view-state", strings.NewReader(`{"view_state":{"active_view":"visual"}}`)))
	if view.Code != http.StatusOK || !strings.Contains(view.Body.String(), `"active_view":"visual"`) {
		t.Fatalf("unexpected view state response: %d %s", view.Code, view.Body.String())
	}

	ai := httptest.NewRecorder()
	router.ServeHTTP(ai, httptest.NewRequest(http.MethodPost, "/api/compare-workspaces/"+workspace.ID+"/ai-sessions", strings.NewReader(`{"question":"why?","analysis":"because","provider":"test","model":"test"}`)))
	if ai.Code != http.StatusCreated || !strings.Contains(ai.Body.String(), `"analysis":"because"`) {
		t.Fatalf("unexpected AI session response: %d %s", ai.Code, ai.Body.String())
	}

	unknownRevision := httptest.NewRecorder()
	router.ServeHTTP(unknownRevision, httptest.NewRequest(http.MethodPost, "/api/compare-workspaces/"+workspace.ID+"/analyze", strings.NewReader(`{"evidence_revision_id":"rev-missing","question":"why?"}`)))
	if unknownRevision.Code != http.StatusBadRequest || !strings.Contains(unknownRevision.Body.String(), "revision does not exist") {
		t.Fatalf("unexpected unknown revision response: %d %s", unknownRevision.Code, unknownRevision.Body.String())
	}
}
