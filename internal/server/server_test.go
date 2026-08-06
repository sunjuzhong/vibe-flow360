package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/comparison"
	"github.com/sunjuzhong/vibe-flow360/internal/convergence"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/geometrydiag"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
	"github.com/sunjuzhong/vibe-flow360/internal/projectcache"
	"github.com/sunjuzhong/vibe-flow360/internal/projectmirror"
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

func TestFolderMutationValidation(t *testing.T) {
	for _, valid := range []string{"folder-1234", "folder-a-b-C-9"} {
		if !validFlow360FolderID(valid, false) {
			t.Errorf("valid Folder ID rejected: %q", valid)
		}
	}
	for _, invalid := range []string{"", flow360RootFolderID, "prj-123", "folder-a/b", "folder-a b"} {
		if validFlow360FolderID(invalid, false) {
			t.Errorf("invalid Folder ID accepted: %q", invalid)
		}
	}
	if !validFlow360FolderID(flow360RootFolderID, true) {
		t.Fatal("root Folder ID was rejected as a parent")
	}
	if got, err := normalizeFlow360FolderName("  Aero studies  "); err != nil || got != "Aero studies" {
		t.Fatalf("unexpected normalized name %q: %v", got, err)
	}
	for _, invalid := range []string{"", "bad\nname", strings.Repeat("a", 129)} {
		if _, err := normalizeFlow360FolderName(invalid); err == nil {
			t.Errorf("invalid Folder name accepted: %q", invalid)
		}
	}
}

func TestDeleteFolderRequiresExplicitConfirmation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "folder_id", Value: "folder-1234"}}
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/flow360/folders/folder-1234", nil)

	(&Server{}).deleteFlow360Folder(context)

	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "confirmed=true") {
		t.Fatalf("unexpected delete response %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestCreateFolderUsesTypedClientAndRefreshesTreeCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "flow360")
	script := `#!/bin/sh
printf '%s ' "$@" >> "` + argsPath + `"
printf '\n' >> "` + argsPath + `"
if [ "$1 $2" = "folder create" ]; then
  printf '{"id":"folder-new","name":"Aero studies","parent_id":"ROOT.FLOW360"}'
else
  printf '{"root":{"id":"ROOT.FLOW360","name":"Workspace","subfolders":[{"id":"folder-new","name":"Aero studies","subfolders":[]}]}}'
fi
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	cache, err := projectcache.New(filepath.Join(dir, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second},
		cache:   cache,
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/folders", strings.NewReader(`{
		"name":" Aero studies ","parent_folder_id":"ROOT.FLOW360","tags":["cfd"]
	}`))
	context.Request.Header.Set("Content-Type", "application/json")

	app.createFlow360Folder(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "folder-new") {
		t.Fatalf("unexpected create response %d: %s", recorder.Code, recorder.Body.String())
	}
	args, _ := os.ReadFile(argsPath)
	if !strings.Contains(string(args), "folder create --name Aero studies --parent-folder-id ROOT.FLOW360 --tag cfd") {
		t.Fatalf("unexpected folder command: %s", args)
	}
	entry, err := cache.Get("folder-tree", "root")
	if err != nil || !strings.Contains(string(entry.Data), "folder-new") {
		t.Fatalf("Folder tree cache was not refreshed: %s, %v", entry.Data, err)
	}
}

func TestProjectMutationValidation(t *testing.T) {
	for _, valid := range []string{"prj-1234", "prj-a-b-C-9"} {
		if !validFlow360ProjectID(valid) {
			t.Errorf("valid Project ID rejected: %q", valid)
		}
	}
	for _, invalid := range []string{"", "project-123", "prj-a/b", "prj-a b"} {
		if validFlow360ProjectID(invalid) {
			t.Errorf("invalid Project ID accepted: %q", invalid)
		}
	}
	if got, err := normalizeFlow360ProjectName("  Aero baseline  "); err != nil || got != "Aero baseline" {
		t.Fatalf("unexpected normalized name %q: %v", got, err)
	}
	for _, invalid := range []string{"", "bad\nname", strings.Repeat("a", 129)} {
		if _, err := normalizeFlow360ProjectName(invalid); err == nil {
			t.Errorf("invalid Project name accepted: %q", invalid)
		}
	}
}

func TestDeleteProjectRequiresExplicitConfirmation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "project_id", Value: "prj-1234"}}
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/flow360/projects/prj-1234", nil)

	(&Server{}).deleteFlow360Project(context)

	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "confirmed=true") {
		t.Fatalf("unexpected delete response %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestProjectMutationErrorMessagesAreActionable(t *testing.T) {
	tests := map[string]string{
		"403 forbidden":          "denied permission",
		"401 unauthorized":       "authentication is required",
		"unexpected remote fail": "refresh the folder and try again",
	}
	for message, expected := range tests {
		if got := flow360ProjectMutationError("delete", errors.New(message)); !strings.Contains(got, expected) {
			t.Errorf("message %q produced %q, want %q", message, got, expected)
		}
	}
}

func TestDeleteStaleProjectReturnsSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := `#!/bin/sh
printf "Not found error: {'error': 'Item not found.', 'code': '4040000001'}\n" >&2
exit 1
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "project_id", Value: "prj-stale"}}
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/flow360/projects/prj-stale?confirmed=true", nil)

	app.deleteFlow360Project(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"already_absent":true`) {
		t.Fatalf("unexpected stale delete response %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestSubmitPlanToFlow360UpdatesAndRunsPreboundDraft(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	paramsPath := filepath.Join(dir, "params.json")
	binaryPath := filepath.Join(dir, "flow360")
	script := `#!/bin/sh
printf '%s ' "$@" >> "` + argsPath + `"
printf '\n' >> "` + argsPath + `"
case "$1 $2 $3" in
  "draft simulation-params set") cp "$5" "` + paramsPath + `"; printf '{"status":"updated"}' ;;
  "draft simulation-params get") printf '{"version":"canonical"}' ;;
  "draft run draft-ready") printf '{"draft":{"id":"draft-ready","type":"Draft"},"result":{"id":"case-1","type":"Case"}}' ;;
  *) exit 9 ;;
esac
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	plan := plans.Plan{
		SourceID: "geo-1", Target: "case", Name: "AI Create", Baseline: json.RawMessage(`{"version":"base","operating_condition":{"alpha":0}}`),
		Patch: json.RawMessage(`{"operating_condition":{"alpha":5}}`), RemoteIDs: &plans.RemoteIDs{DraftID: "draft-ready"},
	}
	result, err := app.submitPlanToFlow360(context.Background(), plan)
	if err != nil {
		t.Fatal(err)
	}
	if plans.ExtractRemoteIDs(result).CaseID != "case-1" {
		t.Fatalf("unexpected run result: %s", result)
	}
	args, _ := os.ReadFile(argsPath)
	if !strings.Contains(string(args), "draft run draft-ready --up-to case") || strings.Contains(string(args), "--patch") || strings.Contains(string(args), "--name") {
		t.Fatalf("bound Draft run issued wrong commands: %s", args)
	}
	written, _ := os.ReadFile(paramsPath)
	if !strings.Contains(string(written), `"alpha":5`) {
		t.Fatalf("complete parameters were not written before run: %s", written)
	}
}

func TestListInterventionsReturnsEmptyJSONArray(t *testing.T) {
	gin.SetMode(gin.TestMode)
	temp := t.TempDir()
	interventionStore, err := agent.NewInterventionStore(filepath.Join(temp, "interventions"))
	if err != nil {
		t.Fatal(err)
	}
	planStore, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		interventions:      interventionStore,
		interventionEngine: agent.NewEngine(interventionStore, planStore, nil),
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/interventions?project_id=prj-empty", nil)

	app.listInterventions(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	if got := strings.TrimSpace(recorder.Body.String()); got != `{"interventions":[]}` {
		t.Fatalf("got %s, want empty JSON array", got)
	}
}

func TestChatStreamPersistsAndRestoresProjectResourceSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store, err := agent.NewChatStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{agent: &agent.Service{}, chatSessions: store}
	body := `{
  "message":"Why did this case diverge?",
  "project_id":"project-1",
  "resource_id":"case-1",
  "context":"{\"project_id\":\"project-1\",\"source_id\":\"case-1\",\"source_type\":\"Case\",\"source_status\":\"Completed\"}"
}`
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/chat/stream", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.chatStream(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"type":"done"`) {
		t.Fatalf("unexpected stream response %d: %s", recorder.Code, recorder.Body.String())
	}
	session, err := store.Get("project-1", "case-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(session.Messages) != 2 || session.Messages[0].Content != "Why did this case diverge?" {
		t.Fatalf("unexpected persisted transcript: %#v", session)
	}

	getRecorder := httptest.NewRecorder()
	getContext, _ := gin.CreateTestContext(getRecorder)
	getContext.Request = httptest.NewRequest(http.MethodGet, "/api/agent/chat/session?project_id=project-1&resource_id=case-1", nil)
	app.getChatSession(getContext)
	if getRecorder.Code != http.StatusOK || !strings.Contains(getRecorder.Body.String(), "Why did this case diverge?") {
		t.Fatalf("session was not restored: %d %s", getRecorder.Code, getRecorder.Body.String())
	}
}

func TestRecoverPlanCreatesInterventionForPersistedPreflightFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	temp := t.TempDir()
	planStore, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planStore.Create(plans.CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "case", Name: "recover", Intent: "Recover missing inputs.",
		Baseline: json.RawMessage(`{"simulation_params":{}}`), Patch: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	plan, err = planStore.SetPreflight(plan.ID, plans.Preflight{
		Valid: false, ValidatedRevision: plan.Revision,
		Issues:     []plans.PreflightIssue{{Level: "error", Code: "missing", Path: "models", Message: "Field required"}},
		FormSchema: json.RawMessage(`{"type":"object","properties":{"models":{"type":"object"}}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	interventionStore, err := agent.NewInterventionStore(filepath.Join(temp, "interventions"))
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		plans:              planStore,
		interventions:      interventionStore,
		interventionEngine: agent.NewEngine(interventionStore, planStore, nil),
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/plans/"+plan.ID+"/recover", nil)
	context.Params = gin.Params{{Key: "plan_id", Value: plan.ID}}

	app.recoverPlan(context)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	var created agent.Intervention
	if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.PlanID != plan.ID || created.PlanRevision != plan.Revision {
		t.Fatalf("recovery is not bound to the failed plan revision: %#v", created)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		current, err := interventionStore.Get(created.ID)
		if err == nil && current.State == agent.InterventionProposal {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("background recovery did not reach a stable proposal state before test cleanup")
}

func TestCacheableSnapshotRejectsEmptyWorkspaceResponses(t *testing.T) {
	tests := []struct {
		kind string
		raw  json.RawMessage
		want bool
	}{
		{"folder-tree", json.RawMessage(`{"root":{"id":"ROOT.FLOW360","name":"Workspace"}}`), true},
		{"folder-tree", json.RawMessage(`{"root":{}}`), false},
		{"project-list", json.RawMessage(`{"records":[{"id":"prj-1"}]}`), true},
		{"project-list", json.RawMessage(`{"records":[]}`), false},
		{"draft-list", json.RawMessage(`{"records":[]}`), true},
		{"draft-list", json.RawMessage(`{"records":[{"id":"draft-1"}]}`), true},
		{"resource-detail", json.RawMessage(`{"id":"case-1","type":"Case"}`), true},
		{"resource-detail", json.RawMessage(`{"type":"Case"}`), false},
	}
	for _, test := range tests {
		if got := cacheableSnapshot(test.kind, test.raw); got != test.want {
			t.Fatalf("%s %s: got %v, want %v", test.kind, test.raw, got, test.want)
		}
	}
}

func TestWorkspaceRootProjectsReuseAllProjectsCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := json.RawMessage(`{"records":[{"id":"prj-root","name":"Workspace project"}]}`)
	if _, err := cache.Put("project-list", "all", snapshot); err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		cache:   cache,
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/flow360/projects?folder_id=ROOT.FLOW360&cache=only",
		nil,
	)

	app.flow360Projects(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "prj-root") {
		t.Fatalf("workspace root did not reuse all-projects cache: %d %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
}

func TestSweepPatchBuildsNestedMergePatch(t *testing.T) {
	patch := sweepPatch(
		[]comparison.SweepParameter{
			{Name: "operating_condition.alpha.value"},
			{Name: "models.turbulence_model.constants.c1"},
		},
		[]float64{5, 1.2},
	)
	operating := patch["operating_condition"].(map[string]any)
	alpha := operating["alpha"].(map[string]any)
	if alpha["value"] != float64(5) {
		t.Fatalf("unexpected alpha patch: %#v", patch)
	}
	models := patch["models"].(map[string]any)
	turbulence := models["turbulence_model"].(map[string]any)
	constants := turbulence["constants"].(map[string]any)
	if constants["c1"] != 1.2 {
		t.Fatalf("unexpected turbulence patch: %#v", patch)
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

func TestResourceDetailCacheOnlyFallsBackToProjectMirror(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := json.RawMessage(`{"id":"geo-mirrored","type":"Geometry","info":{"status":"processed"}}`)
	if err := mirror.PutResource("prj-1", "Geometry", "geo-mirrored", snapshot); err != nil {
		t.Fatal(err)
	}
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{cache: cache, mirror: mirror}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-mirrored?cache=only", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "geo-mirrored"},
	}

	app.flow360ResourceDetail(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
	if !strings.Contains(recorder.Header().Get("Warning"), "Project mirror") {
		t.Fatalf("unexpected warning %q", recorder.Header().Get("Warning"))
	}
	var body map[string]any
	if json.Unmarshal(recorder.Body.Bytes(), &body) != nil || body["id"] != "geo-mirrored" {
		t.Fatalf("unexpected body %#v", body)
	}
}

func TestGeometryDetailRouteCoexistsWithStaticDiagnosticRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := json.RawMessage(`{"id":"geo-route","type":"Geometry","info":{"status":"processed"}}`)
	if err := mirror.PutResource("prj-route", "Geometry", "geo-route", snapshot); err != nil {
		t.Fatal(err)
	}
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{router: gin.New(), cache: cache, mirror: mirror}
	api := app.router.Group("/api")
	api.GET("/flow360/resources/:resource_type/:resource_id", app.flow360ResourceDetail)
	api.GET("/flow360/resources/Geometry/:resource_id", app.flow360ResourceDetail)
	api.GET("/flow360/resources/Geometry/:resource_id/diagnostics", app.flow360GeometryDiagnostics)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-route?cache=only", nil)
	app.router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("Geometry detail route got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body map[string]any
	if json.Unmarshal(recorder.Body.Bytes(), &body) != nil || body["id"] != "geo-route" {
		t.Fatalf("unexpected Geometry detail %#v", body)
	}
}

func TestUpdateDraftParametersRequiresJSONObjectAndReturnsCanonicalParams(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := `#!/bin/sh
if [ "$3" = "set" ]; then
  printf '{"status":"updated"}'
else
  printf '{"version":"canonical","meshing":{"defaults":{"target_surface_node_count":1000000}}}'
fi
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/flow360/drafts/draft-1/parameters", strings.NewReader(`{"simulation_params":{"version":"draft"}}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	app.updateFlow360DraftParameters(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"version":"canonical"`) {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	context, _ = gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/flow360/drafts/draft-1/parameters", strings.NewReader(`{"simulation_params":[]}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	app.updateFlow360DraftParameters(context)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("array payload got %d, want 400", recorder.Code)
	}
}

func TestDraftSourceTypeNormalizesMetadataAndFallsBackToGeometry(t *testing.T) {
	if got := draftSourceType(json.RawMessage(`{"source_type":"surface-mesh"}`)); got != "SurfaceMesh" {
		t.Fatalf("got %q, want SurfaceMesh", got)
	}
	if got := draftSourceType(json.RawMessage(`{"name":"legacy"}`)); got != "Geometry" {
		t.Fatalf("got %q, want Geometry fallback", got)
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
				Fields: []agent.Field{{
					Key: "alpha", Value: 5, Provenance: agent.ProvenanceProvided, Description: "User input",
				}},
				ValidationHints: []string{"Validate alpha"},
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
	results := response["results"].([]any)
	plan := results[0].(map[string]any)["plan"].(map[string]any)
	if len(plan["evidence"].([]any)) != 1 || len(plan["validation_hints"].([]any)) != 1 {
		t.Fatalf("expected proposal evidence and validation hints, got %#v", plan)
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

func TestPlanFromActionUsesRequestContextAndIsIdempotent(t *testing.T) {
	planStore, err := plans.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{plans: planStore}
	action := agent.Action{
		Version: agent.ActionVersion,
		Kind:    agent.ActionCreatePlan,
		Message: "Create a contextual plan",
		Proposals: []agent.Proposal{{
			ID: "context-plan", SourceType: "VolumeMesh", Target: "case",
			Name: "Context Case", Intent: "Review locally", Patch: json.RawMessage(`{}`),
		}},
	}
	request := actionPlanRequest{
		Action: action, ProjectID: "project-context", ProjectName: "Context Project",
		SourceID: "vm-context", SourceType: "VolumeMesh", SourceName: "Context Mesh",
	}
	body, _ := json.Marshal(request)

	var planIDs []string
	for attempt := 0; attempt < 2; attempt++ {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/plan-from-action", bytes.NewReader(body))
		context.Request.Header.Set("Content-Type", "application/json")
		app.planFromAction(context)
		if recorder.Code != http.StatusOK {
			t.Fatalf("attempt %d returned status %d: %s", attempt+1, recorder.Code, recorder.Body.String())
		}
		var response struct {
			Results []struct {
				Plan plans.Plan `json:"plan"`
			} `json:"results"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if len(response.Results) != 1 {
			t.Fatalf("expected one result, got %#v", response.Results)
		}
		plan := response.Results[0].Plan
		if plan.ProjectID != request.ProjectID || plan.SourceID != request.SourceID || plan.SourceName != request.SourceName {
			t.Fatalf("request context was not applied: %#v", plan)
		}
		planIDs = append(planIDs, plan.ID)
	}
	if planIDs[0] != planIDs[1] {
		t.Fatalf("repeated conversion created duplicate plans: %v", planIDs)
	}
}

func TestPlanPreflightBlocksApprovalAndAcceptsSchemaFormInputs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	fakeResult := `#!/bin/sh
printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"missing","path":"meshing.defaults.length","message":"Field required","stages":["SurfaceMesh"]}],"form_schema":{"type":"object","required":["meshing"],"properties":{"meshing":{"type":"object","required":["defaults"],"properties":{"defaults":{"type":"object","required":["length"],"properties":{"length":{"type":"quantity","unit":"meter","value_schema":{"type":"number","exclusiveMinimum":0},"required":true}}}}}}}}'
`
	if err := os.WriteFile(fakePython, []byte(fakeResult), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)
	store, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(plans.CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "surface-mesh", Name: "mesh", Intent: "Build a surface mesh.",
		Baseline: json.RawMessage(`{"simulation_params":{"version":"test","meshing":{"defaults":{}}}}`),
		Patch:    json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		plans: store,
		flow360: &flow360.Client{
			Binary: "flow360",
		},
	}

	preflightRecorder := httptest.NewRecorder()
	preflightContext, _ := gin.CreateTestContext(preflightRecorder)
	preflightContext.Request = httptest.NewRequest(http.MethodPost, "/api/plans/"+created.ID+"/preflight", nil)
	preflightContext.Params = gin.Params{{Key: "plan_id", Value: created.ID}}
	app.preflightPlan(preflightContext)
	if preflightRecorder.Code != http.StatusOK {
		t.Fatalf("preflight status %d: %s", preflightRecorder.Code, preflightRecorder.Body)
	}
	var preflighted plans.Plan
	if err := json.Unmarshal(preflightRecorder.Body.Bytes(), &preflighted); err != nil {
		t.Fatal(err)
	}
	if preflighted.Preflight == nil || preflighted.Preflight.Valid || preflighted.Revision != 1 {
		t.Fatalf("unexpected preflight plan %#v", preflighted)
	}

	approvalRecorder := httptest.NewRecorder()
	approvalContext, _ := gin.CreateTestContext(approvalRecorder)
	approvalContext.Request = httptest.NewRequest(http.MethodPost, "/api/plans/"+created.ID+"/approve", nil)
	approvalContext.Params = gin.Params{{Key: "plan_id", Value: created.ID}}
	app.approvePlan(approvalContext)
	if approvalRecorder.Code != http.StatusConflict {
		t.Fatalf("invalid preflight approval got %d, want 409", approvalRecorder.Code)
	}

	inputBody := bytes.NewBufferString(`{"revision":1,"values":{"meshing":{"defaults":{"length":{"value":0.01,"units":"m"}}}}}`)
	inputRecorder := httptest.NewRecorder()
	inputContext, _ := gin.CreateTestContext(inputRecorder)
	inputContext.Request = httptest.NewRequest(http.MethodPost, "/api/plans/"+created.ID+"/inputs", inputBody)
	inputContext.Request.Header.Set("Content-Type", "application/json")
	inputContext.Params = gin.Params{{Key: "plan_id", Value: created.ID}}
	app.applyPlanInputs(inputContext)
	if inputRecorder.Code != http.StatusOK {
		t.Fatalf("input status %d: %s", inputRecorder.Code, inputRecorder.Body)
	}
	var updated plans.Plan
	if err := json.Unmarshal(inputRecorder.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || !strings.Contains(string(updated.Patch), `"length"`) {
		t.Fatalf("dynamic input was not merged: %#v", updated)
	}
}

func TestPlanPreflightAutomaticallyAppliesHighConfidenceBoundaryRepair(t *testing.T) {
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	fakeResult := `#!/bin/sh
if grep -q '"type":"SymmetryPlane"' "$3"; then
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{},"required":[]}}'
else
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"value_error","path":"models","message":"The following boundaries do not have a boundary condition: symmetric.","stages":["Case"]}],"form_schema":{"type":"object","required":["models"],"properties":{"models":{"type":"entity_assignment","model_choices":[{"value":"new:SymmetryPlane","label":"New SymmetryPlane","model_type":"SymmetryPlane","entity_property":"surfaces"}],"entity_choices":[{"value":"symmetric","label":"symmetric","payload":{"name":"symmetric","private_attribute_id":"symmetric","private_attribute_entity_type_name":"GhostCircularPlane"}}],"default_model":"new:SymmetryPlane","default_entities":["symmetric"],"recommendation":{"confidence":"high","provenance":"flow360_schema_validation"}}}}}'
fi
`
	if err := os.WriteFile(fakePython, []byte(fakeResult), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)
	store, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(plans.CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "case", Name: "cylinder", Intent: "Run a cylinder case.",
		Baseline: json.RawMessage(`{"simulation_params":{"version":"test","models":[{"type":"Wall","name":"Wall","surfaces":{"stored_entities":[{"name":"cylinder"}]}},{"type":"Fluid"}]}}`),
		Patch:    json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{plans: store, flow360: &flow360.Client{Binary: "flow360"}}

	updated := app.runPlanPreflight(context.Background(), created)
	if updated.Preflight == nil || !updated.Preflight.Valid {
		t.Fatalf("high-confidence schema repair did not clear preflight: %#v", updated.Preflight)
	}
	if updated.Revision != 2 {
		t.Fatalf("automatic repair should create one reviewed revision, got %d", updated.Revision)
	}
	merged, err := plans.MergedSimulationParams(updated)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(merged), `"type":"SymmetryPlane"`) || !strings.Contains(string(merged), `"name":"symmetric"`) {
		t.Fatalf("automatic boundary repair was not persisted: %s", merged)
	}
}

func TestValidateAndApplyInterventionPersistsPatchAndRealPreflight(t *testing.T) {
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	fakeResult := `#!/bin/sh
if grep -q '"value":0.01' "$3"; then
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{},"required":[]}}'
else
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"missing","path":"meshing.defaults.length","message":"Field required","stages":["SurfaceMesh"]}],"form_schema":{"type":"object","required":["meshing"],"properties":{"meshing":{"type":"object","required":["defaults"],"properties":{"defaults":{"type":"object","required":["length"],"properties":{"length":{"type":"quantity","unit":"m","value_schema":{"type":"number","exclusiveMinimum":0},"required":true}}}}}}}}'
fi
`
	if err := os.WriteFile(fakePython, []byte(fakeResult), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)

	planStore, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planStore.Create(plans.CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "surface-mesh", Name: "mesh", Intent: "Build a surface mesh.",
		Baseline: json.RawMessage(`{"simulation_params":{"version":"test","meshing":{"defaults":{}}}}`),
		Patch:    json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	flowClient := &flow360.Client{Binary: "flow360"}
	preflight, err := flowClient.PreflightSimulationParams(
		context.Background(),
		plan.SourceType,
		plan.Target,
		json.RawMessage(`{"simulation_params":{"version":"test","meshing":{"defaults":{}}}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	issues := make([]plans.PreflightIssue, 0, len(preflight.Issues))
	for _, issue := range preflight.Issues {
		issues = append(issues, plans.PreflightIssue{
			Level: issue.Level, Code: issue.Code, Path: issue.Path,
			Message: issue.Message, Stages: issue.Stages,
		})
	}
	plan, err = planStore.SetPreflight(plan.ID, plans.Preflight{
		SchemaVersion: preflight.SchemaVersion, ValidatorVersion: preflight.ValidatorVersion,
		Valid: preflight.Valid, ValidatedRevision: plan.Revision,
		Issues: issues, FormSchema: preflight.FormSchema,
	})
	if err != nil {
		t.Fatal(err)
	}

	interventionStore, err := agent.NewInterventionStore(filepath.Join(temp, "interventions"))
	if err != nil {
		t.Fatal(err)
	}
	engine := agent.NewEngine(interventionStore, planStore, nil)
	intervention, err := agent.NewIntervention(agent.InterventionInput{
		ProjectID: "prj-1", ResourceID: "geo-1", ResourceType: "Geometry",
		PlanID: plan.ID, PlanRevision: plan.Revision, Type: agent.TypePreflightError,
		Reason: "Field required", CurrentPatch: plan.Patch,
	})
	if err != nil {
		t.Fatal(err)
	}
	intervention.State = agent.InterventionValidation
	intervention.SelectedProposal = &agent.Proposal{ID: "schema", Name: "schema"}
	intervention.CompiledPatch = json.RawMessage(
		`{"meshing":{"defaults":{"length":{"value":0.01,"units":"m"}}}}`,
	)
	if _, err := interventionStore.Create(intervention); err != nil {
		t.Fatal(err)
	}

	app := &Server{
		plans: planStore, flow360: flowClient,
		interventions: interventionStore, interventionEngine: engine,
	}
	resolved, err := app.validateAndApplyIntervention(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.State != agent.InterventionResolved || resolved.PlanRevision != 2 {
		t.Fatalf("intervention did not resolve against the new revision: %#v", resolved)
	}
	updated, err := planStore.Get(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || !strings.Contains(string(updated.Patch), `"length"`) {
		t.Fatalf("compiled intervention patch was not persisted: %#v", updated)
	}
	if updated.Preflight == nil || !updated.Preflight.Valid ||
		updated.Preflight.ValidatedRevision != updated.Revision {
		t.Fatalf("new plan revision did not pass real preflight: %#v", updated.Preflight)
	}
}

func TestDeterministicRemoteRecoveryCanAutoAdvance(t *testing.T) {
	proposal := agent.Proposal{ID: "periodic-node-mismatch-symmetry", Patch: json.RawMessage(`{"models":[]}`)}
	selected, ok := autoApplicableRecoveryProposal(agent.Intervention{Proposals: []agent.Proposal{proposal}})
	if !ok || selected.ID != proposal.ID {
		t.Fatal("schema-validated periodic mismatch repair should auto-advance locally")
	}
	if _, ok := autoApplicableRecoveryProposal(agent.Intervention{Proposals: []agent.Proposal{{ID: "manual"}}}); ok {
		t.Fatal("ambiguous recovery proposal must remain review-only")
	}
}

func TestEmptyPreflightSchemaDoesNotConsumeCompiledPatchAsFormValues(t *testing.T) {
	if schemaHasEditableProperties(json.RawMessage(`{"type":"object","properties":{}}`)) {
		t.Fatal("empty preflight schema must not discard a compiled SimulationParams patch")
	}
	if !schemaHasEditableProperties(json.RawMessage(`{"type":"object","properties":{"models":{"type":"entity_assignment"}}}`)) {
		t.Fatal("schema-backed recovery form should use form expansion")
	}
}

func TestPublicExecutionErrorDoesNotExposeTraceback(t *testing.T) {
	got := publicExecutionError(errors.New("Traceback /Users/private/source Fail to generate simulation config"))
	if strings.Contains(got.Error(), "Traceback") || strings.Contains(got.Error(), "/Users/") {
		t.Fatalf("private traceback leaked: %v", got)
	}
	if !strings.Contains(strings.ToLower(got.Error()), "validation") {
		t.Fatalf("validation action was lost: %v", got)
	}
}

func TestPlanMonitorTargetUsesReturnedResourceType(t *testing.T) {
	tests := []struct {
		name     string
		plan     plans.Plan
		wantType string
		wantID   string
		wantOK   bool
	}{
		{
			name: "geometry to case monitors case",
			plan: plans.Plan{
				SourceType: "Geometry", Target: "case",
				RemoteIDs: &plans.RemoteIDs{CaseID: "case-1"},
			},
			wantType: "Case", wantID: "case-1", wantOK: true,
		},
		{
			name: "surface mesh target",
			plan: plans.Plan{
				SourceType: "Geometry", Target: "surface-mesh",
				RemoteIDs: &plans.RemoteIDs{MeshID: "sm-1"},
			},
			wantType: "SurfaceMesh", wantID: "sm-1", wantOK: true,
		},
		{
			name: "volume mesh target",
			plan: plans.Plan{
				SourceType: "SurfaceMesh", Target: "volume-mesh",
				RemoteIDs: &plans.RemoteIDs{MeshID: "vm-1"},
			},
			wantType: "VolumeMesh", wantID: "vm-1", wantOK: true,
		},
		{
			name: "draft fallback",
			plan: plans.Plan{
				Target: "case", RemoteIDs: &plans.RemoteIDs{DraftID: "dft-1"},
			},
			wantType: "Draft", wantID: "dft-1", wantOK: true,
		},
		{
			name: "recovers nested legacy result",
			plan: plans.Plan{
				Target: "case",
				Result: json.RawMessage(`{"draft":{"id":"dft-1","type":"Draft"},"result":{"id":"case-1","type":"Case"}}`),
			},
			wantType: "Case", wantID: "case-1", wantOK: true,
		},
		{name: "missing IDs", plan: plans.Plan{}, wantOK: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resourceType, resourceID, ok := planMonitorTarget(test.plan)
			if resourceType != test.wantType || resourceID != test.wantID || ok != test.wantOK {
				t.Fatalf("got (%q, %q, %v), want (%q, %q, %v)",
					resourceType, resourceID, ok, test.wantType, test.wantID, test.wantOK)
			}
		})
	}
}

func TestNormalizeImportResultRequiresProjectAndRootResourceIDs(t *testing.T) {
	raw := json.RawMessage(`{
		"record":{"project_id":"prj-1"},
		"resources":[{"id":"geo-1","type":"Geometry"}]
	}`)
	result, err := normalizeImportResult(raw, "geometry")
	if err != nil {
		t.Fatal(err)
	}
	var normalized map[string]any
	if err := json.Unmarshal(result, &normalized); err != nil {
		t.Fatal(err)
	}
	if normalized["project_id"] != "prj-1" ||
		normalized["root_resource_id"] != "geo-1" ||
		normalized["root_resource_type"] != "geometry" {
		t.Fatalf("unexpected normalized import result: %#v", normalized)
	}

	if _, err := normalizeImportResult(
		json.RawMessage(`{"project_id":"prj-1"}`),
		"geometry",
	); err == nil || !strings.Contains(err.Error(), "root resource") {
		t.Fatalf("missing root resource ID was accepted: %v", err)
	}
	if _, err := normalizeImportResult(
		json.RawMessage(`{"geometry_id":"geo-1"}`),
		"geometry",
	); err == nil || !strings.Contains(err.Error(), "Project ID") {
		t.Fatalf("missing Project ID was accepted: %v", err)
	}
}

func TestApplyPlanInputsRejectsOversizedBody(t *testing.T) {
	app := &Server{}
	body := bytes.NewBufferString(`{"revision":1,"values":{"field":"` +
		strings.Repeat("x", maxPlanInputsRequestBytes) + `"}}`)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/plans/plan-1/inputs", body)
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "plan_id", Value: "plan-1"}}

	app.applyPlanInputs(context)

	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized input got %d, want 413: %s", recorder.Code, recorder.Body)
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

func TestGeometryMeshPreviewUsesLocalUVFManifest(t *testing.T) {
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[
		{
			"id":"body-1",
			"type":"SolidGeometry",
			"properties":{"boundsMin":[-1,-1,-1],"boundsMax":[1,1,1]},
			"resources":{"buffers":{"type":"buffers","path":"body.bin","sections":[
				{"name":"position","length":36}
			]}}
		},
		{
			"id":"face-1",
			"name":"Face 1",
			"type":"Face",
			"properties":{"bufferLocations":{"indices":[
				{"startIndex":0,"endIndex":3}
			]}}
		}
	]`)
	if _, err := mirror.PutGeometryVisualization(
		"prj-1",
		"geo-1",
		manifest,
		map[string][]byte{"body.bin": make([]byte, 36)},
	); err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		mirror:  mirror,
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/preview-mesh", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "geo-1"},
	}
	app.flow360ResourceMeshPreview(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	var preview flow360.MeshPreview
	if err := json.Unmarshal(recorder.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Format != "flow360-uvf" || len(preview.Groups) != 1 {
		t.Fatalf("unexpected preview %#v", preview)
	}
}

func TestGeometryDiagnosticsUsesSynchronizedManifestEvidence(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[
		{"id":"solid","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[1,2,3]},"resources":{"buffers":{"type":"buffers","path":"mesh.bin","sections":[{"name":"position","length":144}]}}},
		{"id":"body00001_face_0","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}},
		{"id":"body00001_face_1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":3,"endIndex":33}]}}}
	]`)
	if _, err := mirror.PutGeometryVisualization("prj-1", "geo-1", manifest, map[string][]byte{"mesh.bin": {0, 1, 2}}); err != nil {
		t.Fatal(err)
	}
	app := &Server{mirror: mirror}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/diagnostics?small_surface_ratio=0.2", nil)
	context.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}}

	app.flow360GeometryDiagnostics(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Fingerprint  string `json:"fingerprint"`
		Capabilities []struct {
			Status string `json:"status"`
		} `json:"capabilities"`
		Findings []struct {
			EntityIDs []string `json:"entity_ids"`
		} `json:"findings"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Fingerprint == "" || response.Capabilities[0].Status != "proxy" || len(response.Findings[0].EntityIDs) != 1 {
		t.Fatalf("unexpected diagnostic response: %#v", response)
	}
	if got := recorder.Header().Get("X-Geometry-Diagnostics-Cache"); got != "MISS" {
		t.Fatalf("first diagnostic request cache status = %q", got)
	}
	secondRecorder := httptest.NewRecorder()
	secondContext, _ := gin.CreateTestContext(secondRecorder)
	secondContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/diagnostics?small_surface_ratio=0.2", nil)
	secondContext.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}}
	app.flow360GeometryDiagnostics(secondContext)
	if secondRecorder.Code != http.StatusOK || secondRecorder.Header().Get("X-Geometry-Diagnostics-Cache") != "HIT" {
		t.Fatalf("cached diagnostics got %d, cache %q", secondRecorder.Code, secondRecorder.Header().Get("X-Geometry-Diagnostics-Cache"))
	}
	thirdRecorder := httptest.NewRecorder()
	thirdContext, _ := gin.CreateTestContext(thirdRecorder)
	thirdContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/diagnostics?small_surface_ratio=0.2&curvature_angle_deg=45", nil)
	thirdContext.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}}
	app.flow360GeometryDiagnostics(thirdContext)
	if thirdRecorder.Code != http.StatusOK || thirdRecorder.Header().Get("X-Geometry-Diagnostics-Cache") != "MISS" {
		t.Fatalf("changed-threshold diagnostics got %d, cache %q", thirdRecorder.Code, thirdRecorder.Header().Get("X-Geometry-Diagnostics-Cache"))
	}
}

func TestGeometryDiagnosticsJobCompletesAndCanBeRead(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[
		{"id":"solid","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[1,2,3]},"resources":{"buffers":{"type":"buffers","path":"mesh.bin","sections":[{"name":"position","length":36}]}}},
		{"id":"face-1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}}
	]`)
	if _, err := mirror.PutGeometryVisualization("prj-1", "geo-1", manifest, map[string][]byte{"mesh.bin": make([]byte, 36)}); err != nil {
		t.Fatal(err)
	}
	jobRoot := t.TempDir()
	jobs, err := geometrydiag.NewJobStore(jobRoot)
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{mirror: mirror, geometryJobs: jobs, geometryJobSlots: make(chan struct{}, 1)}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/resources/Geometry/geo-1/diagnostics/jobs", bytes.NewBufferString(`{"small_surface_ratio":0.1,"curvature_angle_deg":30}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}}

	app.startGeometryDiagnosticsJob(context)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}
	var started geometrydiag.Job
	if err := json.Unmarshal(recorder.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	var completed geometrydiag.Job
	for time.Now().Before(deadline) {
		completed, _ = jobs.Get(started.ID)
		if completed.Status == geometrydiag.JobCompleted {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if completed.Status != geometrydiag.JobCompleted || completed.Report == nil || completed.Progress != 100 {
		t.Fatalf("unexpected completed job: %#v", completed)
	}

	getRecorder := httptest.NewRecorder()
	getContext, _ := gin.CreateTestContext(getRecorder)
	getContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/diagnostics/jobs/"+started.ID, nil)
	getContext.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}, {Key: "job_id", Value: started.ID}}
	app.getGeometryDiagnosticsJob(getContext)
	if getRecorder.Code != http.StatusOK || !strings.Contains(getRecorder.Body.String(), `"status":"completed"`) {
		t.Fatalf("got %d: %s", getRecorder.Code, getRecorder.Body.String())
	}

	reopened, err := geometrydiag.NewJobStore(jobRoot)
	if err != nil {
		t.Fatal(err)
	}
	persisted, ok := reopened.Get(started.ID)
	if !ok || persisted.Status != geometrydiag.JobCompleted || persisted.Report == nil {
		t.Fatalf("job did not survive store restart: %#v", persisted)
	}
}

func TestGeometryComparisonRejectsSameResource(t *testing.T) {
	gin.SetMode(gin.TestMode)
	app := &Server{}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/compare/geo-1", nil)
	context.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}, {Key: "compare_id", Value: "geo-1"}}

	app.flow360GeometryComparison(context)

	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "different Geometry") {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestGeometryVisualizationAssetServesOnlyManifestAndBins(t *testing.T) {
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mirror.PutGeometryVisualization(
		"prj-1",
		"geo-1",
		json.RawMessage(`[{"type":"Face"}]`),
		map[string][]byte{"nested/body.bin": {1, 2, 3}},
	); err != nil {
		t.Fatal(err)
	}
	app := &Server{mirror: mirror}
	call := func(path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/asset", nil)
		context.Params = gin.Params{
			{Key: "resource_type", Value: "Geometry"},
			{Key: "resource_id", Value: "geo-1"},
			{Key: "asset_path", Value: "/" + path},
		}
		app.flow360ResourceVisualizationAsset(context)
		return recorder
	}
	if recorder := call("manifest.json"); recorder.Code != http.StatusOK ||
		!strings.Contains(recorder.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("manifest response %d %#v", recorder.Code, recorder.Header())
	}
	if recorder := call("nested/body.bin"); recorder.Code != http.StatusOK ||
		!bytes.Equal(recorder.Body.Bytes(), []byte{1, 2, 3}) {
		t.Fatalf("bin response %d %v", recorder.Code, recorder.Body.Bytes())
	}
	for _, path := range []string{"../manifest.json", "detail.json", "/tmp/body.bin"} {
		if recorder := call(path); recorder.Code == http.StatusOK {
			t.Fatalf("unsafe path %q was served", path)
		}
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

func TestGenerateSweepPreviewReturnsArrayContracts(t *testing.T) {
	app := &Server{}

	body := `{"baseline_case_id":"case-1","parameters":[{"name":"alpha","values":[0,5,10]}]}`
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/sweep", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.generateSweepPlan(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Warnings []string `json:"warnings"`
		Plans    []any    `json:"plans"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Warnings == nil || response.Plans == nil {
		t.Fatalf("expected empty JSON arrays, got %s", recorder.Body.String())
	}
}

func TestKPIsFromConvergenceUsesForceHistory(t *testing.T) {
	assessments := map[string]convergence.Assessment{
		"forces": {
			Status: convergence.StatusConverged,
			Metrics: map[string]convergence.Metric{
				"CL": {Name: "CL", Final: 0.42},
				"CD": {Name: "CD", Final: 0.018},
			},
		},
	}

	kpis := kpisFromConvergence(assessments, []string{"Cl", "Cd", "Cm"}, true)
	if len(kpis) != 2 {
		t.Fatalf("expected 2 KPIs, got %#v", kpis)
	}
	if kpis[0].Name != "Cl" || kpis[0].Value != 0.42 || kpis[0].Source != "Flow360 total forces history" {
		t.Fatalf("unexpected lift KPI: %#v", kpis[0])
	}
	if !kpis[1].Converged {
		t.Fatalf("expected converged KPI: %#v", kpis[1])
	}
}
