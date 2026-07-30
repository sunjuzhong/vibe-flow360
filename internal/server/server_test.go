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
	"github.com/sjzsdu/vibe-flow360/internal/agent"
	"github.com/sjzsdu/vibe-flow360/internal/comparison"
	"github.com/sjzsdu/vibe-flow360/internal/convergence"
	"github.com/sjzsdu/vibe-flow360/internal/flow360"
	"github.com/sjzsdu/vibe-flow360/internal/plans"
	"github.com/sjzsdu/vibe-flow360/internal/projectcache"
	"github.com/sjzsdu/vibe-flow360/internal/projectmirror"
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
		{"resource-detail", json.RawMessage(`{"id":"case-1","type":"Case"}`), true},
		{"resource-detail", json.RawMessage(`{"type":"Case"}`), false},
	}
	for _, test := range tests {
		if got := cacheableSnapshot(test.kind, test.raw); got != test.want {
			t.Fatalf("%s %s: got %v, want %v", test.kind, test.raw, got, test.want)
		}
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
