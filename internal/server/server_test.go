package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sjzsdu/vibesim/internal/agent"
	"github.com/sjzsdu/vibesim/internal/flow360"
	"github.com/sjzsdu/vibesim/internal/plans"
	"github.com/sjzsdu/vibesim/internal/projectcache"
)

func TestCacheNamespaceUsesEnvironmentAndProfile(t *testing.T) {
	tests := map[string]struct {
		environment string
		profile     string
		want        string
	}{
		"defaults": {"", "", "production-default"},
		"named":    {"UAT", "Team Profile", "uat-team-profile"},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			if got := cacheNamespace(test.environment, test.profile); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

func TestResourceDetailPartialFailureFallsBackToCompleteSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const cacheKey = "SurfaceMesh/sm-test"
	snapshot := json.RawMessage(`{"id":"sm-test","type":"SurfaceMesh","info":{"status":"completed"}}`)
	if _, err := cache.Put("resource-detail", cacheKey, snapshot); err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: time.Second},
		cache:   cache,
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/SurfaceMesh/sm-test", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "SurfaceMesh"},
		{Key: "resource_id", Value: "sm-test"},
	}

	app.flow360ResourceDetail(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
	var got map[string]any
	var want map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(snapshot, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got body %v, want %v", got, want)
	}
}

// TestProjectInfoCacheOnlyReturnsSnapshotWithoutCallingFlow360 ensures that
// the `?cache=only` flag serves stale snapshots when the live CLI is
// broken — one of the core restart-recovery paths from lf5.10.
func TestProjectInfoCacheOnlyReturnsSnapshotWithoutCallingFlow360(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const projectID = "proj-42"
	snapshot := json.RawMessage(`{"id":"proj-42","name":"Wing Test","solver_version":"2024R1","tags":["baseline"],"root_item":{"id":"geo-1","type":"Geometry"}}`)
	if _, err := cache.Put("project-info", projectID, snapshot); err != nil {
		t.Fatal(err)
	}

	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		cache:   cache,
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/projects/proj-42?cache=only", nil)
	context.Params = gin.Params{{Key: "project_id", Value: projectID}}

	app.flow360ProjectInfo(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
	var got map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["id"] != "proj-42" {
		t.Fatalf("got id %v, want proj-42", got["id"])
	}
}

// TestResourceDetailInvalidKeyReturns404 verifies that unknown
// resource ids return a 404-style error instead of leaking as a 500,
// which is the regression targeted at AC (invalid key) handling.
func TestResourceDetailInvalidKeyReturns404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		cache:   cache,
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/unknown-id", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "unknown-id"},
	}

	app.flow360ResourceDetail(context)

	if recorder.Code == http.StatusOK {
		t.Fatalf("got status 200, want non-200 for an unknown resource id")
	}
}

// TestProjectTreePartialErrorFallsBackToCache documents the case where
// the live flow360 CLI returns a partial response but the Go cache has
// the full tree on disk — the API must not surface the partial payload.
func TestProjectTreePartialErrorFallsBackToCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const projectID = "proj-50"
	snapshot := json.RawMessage(`{"root":{"id":"geo-0","name":"Geometry 0","type":"Geometry","children":[{"id":"sm-0","name":"SurfaceMesh 0","type":"SurfaceMesh","children":[]}]}}`)
	if _, err := cache.Put("project-tree", projectID, snapshot); err != nil {
		t.Fatal(err)
	}

	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		cache:   cache,
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/projects/proj-50/tree", nil)
	context.Params = gin.Params{{Key: "project_id", Value: projectID}}

	app.flow360ProjectTree(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	root, ok := body["root"].(map[string]any)
	if !ok {
		t.Fatalf("expected root object, got %T", body["root"])
	}
	if root["id"] != "geo-0" {
		t.Fatalf("got root id %v, want geo-0", root["id"])
	}
}

func TestPlanFromActionCreatesPlans(t *testing.T) {
	planStore, err := plans.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		plans:   planStore,
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	action := agent.Action{
		Version: agent.ActionVersion,
		Kind:    agent.ActionCreatePlan,
		Message: "Create test plans",
		Proposals: []agent.Proposal{
			{
				ID:         "p1",
				ProjectID:  "prj-1",
				SourceID:   "src-1",
				SourceType: "VolumeMesh",
				Target:     "case",
				Name:       "Test Case",
				Intent:     "Test",
				Patch:      json.RawMessage(`{"alpha":5}`),
			},
		},
	}
	body, _ := json.Marshal(actionPlanRequest{Action: action})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/plan-from-action", bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.planFromAction(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["created"].(float64) != 1 {
		t.Fatalf("expected 1 created, got %v", response["created"])
	}
}

func TestPlanFromActionRejectsNonCreatePlanKind(t *testing.T) {
	planStore, err := plans.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		plans:   planStore,
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	action := agent.Action{
		Version: agent.ActionVersion,
		Kind:    agent.ActionRequestMissingInput,
		Message: "Need more info",
	}
	body, _ := json.Marshal(actionPlanRequest{Action: action})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/plan-from-action", bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.planFromAction(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestResourceMeshPreviewRejectsPathTraversal(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/../etc/passwd/preview-mesh", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "../etc/passwd"},
	}

	app.flow360ResourceMeshPreview(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestResourceMeshPreviewRejectsUnsupportedType(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/UnknownType/id/preview-mesh", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "UnknownType"},
		{Key: "resource_id", Value: "id"},
	}

	app.flow360ResourceMeshPreview(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestCaseConvergenceRejectsNonCase(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/id/convergence", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "id"},
	}

	app.flow360CaseConvergence(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestCaseConvergenceRejectsPathTraversal(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Case/../../etc/passwd/convergence", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Case"},
		{Key: "resource_id", Value: "../../etc/passwd"},
	}

	app.flow360CaseConvergence(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestCompareCasesRequiresAtLeastTwoCases(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	body := `{"case_ids": ["case-1"]}`
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/compare", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.compareCases(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestCompareCasesRejectsInvalidJSON(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/compare", strings.NewReader("not json"))
	context.Request.Header.Set("Content-Type", "application/json")

	app.compareCases(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestGenerateSweepValidatesBaselineCaseID(t *testing.T) {
	app := &Server{}

	body := `{"parameters": []}`
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/sweep", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.generateSweepPlan(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}
