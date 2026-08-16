package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

type fakeCADGenerator struct{}

func (fakeCADGenerator) Generate(_ context.Context, _ aicreate.Geometry, outputPath string) (aicreate.GeometryValidation, error) {
	step := "ISO-10303-21;\nDATA;\n#1=MANIFOLD_SOLID_BREP('agent geometry',#2);\n#2=ADVANCED_FACE('',(),#3,.T.);\nENDSEC;\nEND-ISO-10303-21;\n"
	if err := os.WriteFile(outputPath, []byte(step), 0o600); err != nil {
		return aicreate.GeometryValidation{}, err
	}
	return aicreate.GeometryValidation{SolidCount: 1, FaceCount: 6, Volume: 1, Kernel: "test kernel"}, nil
}

type sequenceCADGenerator struct {
	errors []error
	calls  int
}

func newCADRepairAgent(t *testing.T, calls *int) *agent.Service {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		(*calls)++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"version\":\"v1\",\"decision\":\"generate\",\"project_name\":\"Repaired Cylinder\",\"summary\":\"Repaired exact cylinder.\",\"geometry\":{\"name\":\"repaired-cylinder\",\"unit\":\"m\",\"representation\":\"analytic-brep\",\"format\":\"step\",\"generator\":\"cadquery-dsl-v1\",\"operations\":[{\"id\":\"body\",\"op\":\"cylinder\",\"params\":{\"radius\":0.5,\"height\":1,\"axis\":\"z\"}}],\"results\":[{\"source\":\"body\",\"name\":\"cylinder-body\",\"faces\":[{\"name\":\"cylinder-wall\",\"selector\":\"%CYLINDER\"},{\"name\":\"cap-min\",\"selector\":\"<Z\"},{\"name\":\"cap-max\",\"selector\":\">Z\"}]}]},\"simulation\":{\"velocity_m_s\":10,\"alpha_deg\":0,\"surface_edge_length_m\":0.02,\"first_layer_thickness_m\":0.00002,\"max_steps\":1000},\"assumptions\":[],\"questions\":[]}"}}]}`))
	}))
	t.Cleanup(server.Close)
	return &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: server.URL, Model: "test", Client: server.Client()}
}

func (g *sequenceCADGenerator) Generate(_ context.Context, _ aicreate.Geometry, _ string) (aicreate.GeometryValidation, error) {
	index := g.calls
	g.calls++
	if index < len(g.errors) && g.errors[index] != nil {
		return aicreate.GeometryValidation{}, g.errors[index]
	}
	return aicreate.GeometryValidation{SolidCount: 1, FaceCount: 3, Volume: 1, Kernel: "test"}, nil
}

func validTestFlow360Geometry(name string) aicreate.Geometry {
	return aicreate.Geometry{
		Name: name, Unit: "m", Representation: "analytic-brep", Format: "step", Generator: "cadquery-dsl-v1",
		Operations: []aicreate.Operation{{ID: "body", Op: "cylinder", Params: map[string]any{"radius": 0.5, "height": 1.0, "axis": "z"}}},
		Results: []aicreate.GeometryResult{{Source: "body", Name: "body", Faces: []aicreate.FaceLabel{
			{Name: "wall", Selector: "%CYLINDER"}, {Name: "cap-min", Selector: "<Z"}, {Name: "cap-max", Selector: ">Z"},
		}}},
	}
}

func TestAICreateProjectGeneratesProjectAndCasePlan(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	agentCalls := 0
	agentRequests := make([]string, 0, 2)
	agentServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		agentCalls++
		body, _ := io.ReadAll(r.Body)
		agentRequests = append(agentRequests, string(body))
		w.Header().Set("Content-Type", "application/json")
		content := `{"version":"v1","decision":"generate","project_name":"Agent Flow Geometry","summary":"Agent-designed external-flow geometry.","geometry":{"name":"agent-body","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[{"id":"body","op":"box","params":{"length":2,"width":1,"height":0.5}}],"results":[{"source":"body","name":"fluid-domain","faces":[{"name":"cylinder-side","selector":"%PLANE"}]}]},"simulation":{"velocity_m_s":10,"alpha_deg":0,"surface_edge_length_m":0.03,"first_layer_thickness_m":0.000025,"max_steps":10000},"assumptions":["Review inferred values."],"questions":[]}`
		if agentCalls > 1 {
			content = "```json\n" + `{"version":"v1","kind":"create-plan","message":"Configured from the installed Flow360 schemas.","proposals":[{"id":"schema-plan","action":"Geometry","target":"case","name":"Schema-native setup","intent":"Create a reviewable baseline","patch":{"time_stepping":{"max_steps":2000}},"branch_preview":"schema-native","fields":[{"key":"time_stepping.max_steps","value":2000,"provenance":"inferred"}]}],"questions":[],"warnings":[],"assumptions":["Used the canonical Geometry baseline."]}` + "\n```"
		}
		encoded, _ := json.Marshal(content)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + string(encoded) + `}}]}`))
	}))
	defer agentServer.Close()
	fakeFlow360 := filepath.Join(root, "flow360")
	fakePython := filepath.Join(root, "python")
	script := `#!/bin/sh
case " $* " in
  *" project create "*)
    case " $* " in *" --sync "*) ;; *) exit 9 ;; esac
    case " $* " in *"/agent-body.step "*) ;; *) exit 10 ;; esac
    printf '%s' '{"project_id":"project-ai-1"}'
    ;;
  *" project items project-ai-1 "*)
    printf '%s' '{"items":[{"id":"geometry-ai-1","name":"Cylinder","parent_id":null,"type":"Geometry"}]}'
    ;;
  *" geometry simulation-params get geometry-ai-1 "*)
    printf '%s' '{"simulation_params":{"version":"25.10.17","unit_system":{"name":"SI"},"meshing":{"defaults":{}},"models":[{"type":"Wall","entities":{"stored_entities":[{"name":"*"}]}},{"type":"Freestream"},{"type":"Fluid"}],"private_attribute_asset_cache":{"project_entity_info":{"face_group_tag":"faceId","grouped_faces":[[{"name":"cylinder-side","private_attribute_id":"face-1","private_attribute_tag_key":"faceId","private_attribute_entity_type_name":"Surface","private_attribute_sub_components":["face-1"]}],[{"name":"cylinder-side","private_attribute_id":"cylinder-side","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"}]]}}}}'
    ;;
  *" geometry info geometry-ai-1 "*|*" geometry state geometry-ai-1 "*|*" geometry summary geometry-ai-1 "*)
    printf '%s' '{}'
    ;;
  *" draft list --project-id project-ai-1 "*)
    printf '%s' '{"records":[]}'
    ;;
  *" draft create geometry-ai-1 "*)
    printf '%s' '{"id":"draft-ai-1","type":"Draft","project_id":"project-ai-1"}'
    ;;
  *" draft simulation-params set draft-ai-1 "*)
    printf '%s' '{"status":"updated"}'
    ;;
  *" draft simulation-params get draft-ai-1 "*)
    printf '%s' '{"version":"25.10.17","models":[{"type":"Wall"},{"type":"Freestream"},{"type":"Fluid"}]}'
    ;;
  *) exit 8 ;;
esac
`
	if err := os.WriteFile(fakeFlow360, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	preflightScript := `#!/bin/sh
if [ "$3" = "Geometry" ] && [ "$4" = "geometry-ai-1" ]; then
  printf '%s' '{"simulation_params":{"version":"25.10.17","unit_system":{"name":"SI"},"meshing":{"defaults":{}},"models":[{"type":"Wall","entities":{"stored_entities":[{"name":"*"}]}},{"type":"Freestream"},{"type":"Fluid"}],"private_attribute_asset_cache":{"project_entity_info":{"face_group_tag":"faceId","grouped_faces":[[{"name":"cylinder-side","private_attribute_id":"face-1","private_attribute_tag_key":"faceId","private_attribute_entity_type_name":"Surface","private_attribute_sub_components":["face-1"]}],[{"name":"cylinder-side","private_attribute_id":"cylinder-side","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"}]]}}},"summary":{"id":"geometry-ai-1","summary":{}}}'
else
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{},"required":[]},"editor_schemas":{"SurfaceMesh":{"type":"object","properties":{}},"VolumeMesh":{"type":"object","properties":{}},"Case":{"type":"object","properties":{"time_stepping":{"type":"object","properties":{"max_steps":{"type":"integer","title":"Maximum steps"}}}}}}}'
fi
`
	if err := os.WriteFile(fakePython, []byte(preflightScript), 0o700); err != nil {
		t.Fatal(err)
	}
	planStore, err := plans.NewStore(filepath.Join(root, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360:      &flow360.Client{Binary: fakeFlow360, Timeout: time.Second},
		agent:        &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: agentServer.URL, Model: "test", Client: agentServer.Client()},
		cadGenerator: fakeCADGenerator{},
		plans:        planStore,
		workDir:      root,
	}

	body := bytes.NewBufferString(`{"intent":"帮我实现一个圆柱扰流的仿真试验","folder_id":"folder-1","request_id":"aip-integration-123456"}`)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/ai-create", body)
	context.Request.Header.Set("Content-Type", "application/json")
	app.aiCreateProject(context)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response aiCreateResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.ProjectID != "project-ai-1" || response.RootResourceID != "geometry-ai-1" {
		t.Fatalf("unexpected remote IDs: %#v", response)
	}
	if response.DraftID != "draft-ai-1" {
		t.Fatalf("expected configured remote Draft binding: %#v", response)
	}
	progress := app.aiCreateProgress["aip-integration-123456"]
	if progress.Status != "completed" || progress.Stage != len(progress.Stages) {
		t.Fatalf("expected real backend progress to complete after Draft setup: %#v", progress)
	}
	if progress.ProjectID != response.ProjectID || progress.ResourceID != response.RootResourceID {
		t.Fatalf("expected progress to expose Flow360 resources: %#v", progress)
	}
	if response.Preflight == nil || !response.Preflight.Valid || len(response.SimulationParams) == 0 {
		t.Fatalf("expected schema-valid generated parameters: %#v", response.Preflight)
	}
	if len(agentRequests) < 2 || !strings.Contains(agentRequests[1], "time_stepping.max_steps") {
		t.Fatalf("parameter Agent did not receive the active Flow360 schema catalog: %#v", agentRequests)
	}
	var patch map[string]any
	if err := json.Unmarshal(response.SimulationParams, &patch); err != nil {
		t.Fatal(err)
	}
	models := patch["models"].([]any)
	if patch["time_stepping"].(map[string]any)["max_steps"] != float64(2000) {
		t.Fatalf("schema-native Agent patch was not persisted: %#v", patch)
	}
	wall := models[0].(map[string]any)
	entities := wall["entities"].(map[string]any)["stored_entities"].([]any)
	if len(entities) != 1 || entities[0].(map[string]any)["name"] != "cylinder-side" {
		t.Fatalf("expected concrete CAD Wall assignment: %#v", entities)
	}
	if _, err := os.Stat(filepath.Join(root, "ai-create-sessions")); err != nil {
		t.Fatalf("expected durable session CAD root: %v", err)
	}
	storedSession := app.aiCreateSessions[progress.SessionID]
	if storedSession.Phase != "completed" || storedSession.CAD == nil || storedSession.Parameters == nil || storedSession.DraftID != response.DraftID {
		t.Fatalf("expected completed session checkpoints to remain resumable: %#v", storedSession)
	}
	storedPlans, err := planStore.List(response.ProjectID, "")
	if err != nil || len(storedPlans) != 0 {
		t.Fatalf("AI Create should configure the Draft directly without restoring the removed Plan layer: plans=%#v err=%v", storedPlans, err)
	}
}

func TestAICreateCompletionStagesKeepCreatedProjectInAgentRecovery(t *testing.T) {
	stages := aiCreateCompletionStages(false, false)
	if stages[len(stages)-1] != "Opened Agent Recovery for remaining Flow360 parameter issues" {
		t.Fatalf("created Project did not continue into Agent Recovery: %#v", stages)
	}
	validStages := aiCreateCompletionStages(true, true)
	if validStages[len(validStages)-1] != "Ready for review and approval" {
		t.Fatalf("valid Project did not report completed preflight: %#v", validStages)
	}
}

func TestNormalizeAICreateResultRetriesUntilAsyncRootAppears(t *testing.T) {
	lookups := 0
	lookup := func(_ context.Context, projectID string) (json.RawMessage, error) {
		lookups++
		if projectID != "project-ai-2" {
			t.Fatalf("unexpected project ID %q", projectID)
		}
		if lookups == 1 {
			return json.RawMessage(`{"items":[]}`), nil
		}
		return json.RawMessage(`{"items":[{"id":"geometry-ai-2","type":"Geometry","parent_id":null}]}`), nil
	}
	normalized, err := normalizeAICreateResultWithLookup(
		context.Background(), json.RawMessage(`{"project_id":"project-ai-2"}`),
		"geometry", lookup, 3, time.Millisecond,
	)
	if err != nil {
		t.Fatal(err)
	}
	if lookups != 2 || !bytes.Contains(normalized, []byte(`"root_resource_id":"geometry-ai-2"`)) {
		t.Fatalf("unexpected recovery after %d lookups: %s", lookups, normalized)
	}
}

func TestNormalizeAICreateResultRecoversRootFromTypedProjectResponse(t *testing.T) {
	lookup := func(_ context.Context, projectID string) (json.RawMessage, error) {
		if projectID != "project-ai-typed" {
			t.Fatalf("unexpected Project ID %q", projectID)
		}
		return json.RawMessage(`{"items":[{"id":"geometry-ai-typed","type":"Geometry"}]}`), nil
	}
	normalized, err := normalizeAICreateResultWithLookup(
		context.Background(), json.RawMessage(`{"id":"project-ai-typed","type":"Project"}`),
		"geometry", lookup, 1, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(normalized, []byte(`"root_resource_id":"geometry-ai-typed"`)) {
		t.Fatalf("typed Project response was not normalized: %s", normalized)
	}
}

func TestNormalizeAICreateResultRecoversProjectIDFromCLIText(t *testing.T) {
	lookup := func(_ context.Context, projectID string) (json.RawMessage, error) {
		if projectID != "prj-ecdc6647-9f07-4674-aa50-fa0181b129d9" {
			t.Fatalf("unexpected Project ID %q", projectID)
		}
		return json.RawMessage(`{"items":[{"id":"geo-from-project-items","type":"Geometry"}]}`), nil
	}
	raw := json.RawMessage(`{"result":{"id":"geo-uploaded","type":"Geometry"},"output":"Geometry id = geo-uploaded project id = prj-ecdc6647-9f07-4674-aa50-fa0181b129d9"}`)
	normalized, err := normalizeAICreateResultWithLookup(context.Background(), raw, "geometry", lookup, 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(normalized, []byte(`"root_resource_id":"geo-from-project-items"`)) {
		t.Fatalf("CLI text Project ID was not reconciled: %s", normalized)
	}
}

func TestReconcileAICreateProjectResultRecoversMissingProjectID(t *testing.T) {
	lookups := 0
	notBefore := time.Date(2026, 8, 5, 3, 0, 0, 0, time.UTC)
	lookup := func(_ context.Context, name, sourceType string, boundary time.Time) (json.RawMessage, error) {
		lookups++
		if name != "Cylinder study" || sourceType != "geometry" || !boundary.Equal(notBefore) {
			t.Fatalf("unexpected reconciliation input: %q %q %s", name, sourceType, boundary)
		}
		if lookups == 1 {
			return nil, errors.New("not visible yet")
		}
		return json.RawMessage(`{"id":"prj-recovered","name":"Cylinder study","root_item_type":"Geometry"}`), nil
	}
	reconciled, err := reconcileAICreateProjectResult(
		context.Background(), json.RawMessage(`{"result":{"id":null,"type":"Project"}}`),
		"Cylinder study", "geometry", notBefore, lookup, 3, time.Millisecond,
	)
	if err != nil {
		t.Fatal(err)
	}
	if lookups != 2 || findProjectIDFromRaw(reconciled) != "prj-recovered" {
		t.Fatalf("unexpected reconciliation after %d lookups: %s", lookups, reconciled)
	}
}

func TestReconcileAICreateProjectResultKeepsCompleteResponse(t *testing.T) {
	original := json.RawMessage(`{"id":"prj-complete","type":"Project"}`)
	reconciled, err := reconcileAICreateProjectResult(
		context.Background(), original, "ignored", "geometry", time.Time{},
		func(context.Context, string, string, time.Time) (json.RawMessage, error) {
			t.Fatal("lookup should not run for a complete response")
			return nil, nil
		}, 1, 0,
	)
	if err != nil || !bytes.Equal(reconciled, original) {
		t.Fatalf("complete result changed: %s, %v", reconciled, err)
	}
}

func TestNormalizeAICreateResultReportsCreatedProjectWhenRootNeverAppears(t *testing.T) {
	lookup := func(context.Context, string) (json.RawMessage, error) {
		return nil, errors.New("not ready")
	}
	_, err := normalizeAICreateResultWithLookup(
		context.Background(), json.RawMessage(`{"project_id":"project-ai-3"}`),
		"geometry", lookup, 2, time.Millisecond,
	)
	if err == nil || !bytes.Contains([]byte(err.Error()), []byte("Project project-ai-3 was created")) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestAICreateProjectRequiresFolder(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/ai-create", bytes.NewBufferString(`{"intent":"cylinder flow"}`))
	context.Request.Header.Set("Content-Type", "application/json")
	(&Server{}).aiCreateProject(context)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got %d", recorder.Code)
	}
}

func TestAICreateProjectReportsDetailedIntentLimit(t *testing.T) {
	intent := strings.Repeat("圆", maxAICreateIntentCharacters+17)
	payload, _ := json.Marshal(aiCreateRequest{Intent: intent, FolderID: "folder-1"})
	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Request = httptest.NewRequest(http.MethodPost, "/api/ai-create", bytes.NewReader(payload))
	requestContext.Request.Header.Set("Content-Type", "application/json")
	(&Server{}).aiCreateProject(requestContext)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Code             string `json:"code"`
		Field            string `json:"field"`
		ActualCharacters int    `json:"actual_characters"`
		MaxCharacters    int    `json:"max_characters"`
		ActualBytes      int    `json:"actual_bytes"`
		Error            string `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != "input_too_long" || response.Field != "intent" || response.ActualCharacters != maxAICreateIntentCharacters+17 || response.MaxCharacters != maxAICreateIntentCharacters {
		t.Fatalf("unexpected limit details: %#v", response)
	}
	if response.ActualBytes != len(intent) || !strings.Contains(response.Error, "Remove at least 17 characters") {
		t.Fatalf("limit response is not actionable: %#v", response)
	}
}

func TestAICreateProjectReportsDetailedRequestByteLimit(t *testing.T) {
	payload := `{"intent":"` + strings.Repeat("a", maxAICreateRequestBytes) + `","folder_id":"folder-1"}`
	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Request = httptest.NewRequest(http.MethodPost, "/api/ai-create", strings.NewReader(payload))
	requestContext.Request.Header.Set("Content-Type", "application/json")
	(&Server{}).aiCreateProject(requestContext)
	if recorder.Code != http.StatusRequestEntityTooLarge || !strings.Contains(recorder.Body.String(), `"code":"request_too_large"`) || !strings.Contains(recorder.Body.String(), `"max_request_bytes":20480`) {
		t.Fatalf("unexpected request-size response %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestAICreateConfirmedInputsStayCompactAndAuthoritative(t *testing.T) {
	payload := aiCreateConfirmedInputPayload([]aicreate.ClarificationRound{
		{Fields: []aicreate.ClarificationField{{ID: "target_reynolds_number", Label: strings.Repeat("long explanation ", 1000)}}, Answers: map[string]any{"target_reynolds_number": "3900"}},
		{Answers: map[string]any{"target_reynolds_number": "3900", "analysis_mode": "unsteady"}},
	})
	if len(payload) > 200 || !strings.Contains(string(payload), `"target_reynolds_number":"3900"`) || !strings.Contains(string(payload), `"analysis_mode":"unsteady"`) || strings.Contains(string(payload), "long explanation") {
		t.Fatalf("confirmed answers were not compact and authoritative: %s", payload)
	}
}

func TestGenerateAICreateCADRetriesTemporaryRuntimeFailure(t *testing.T) {
	generator := &sequenceCADGenerator{errors: []error{&aicreate.GenerationError{Kind: aicreate.GenerationTemporaryFailure, Err: errors.New("temporary runtime failure")}}}
	blueprint := aicreate.Blueprint{Geometry: validTestFlow360Geometry("body")}
	result, validation, err := (&Server{}).generateAICreateCAD(context.Background(), generator, aiCreateSession{Intent: "test"}, blueprint, filepath.Join(t.TempDir(), "body.step"), "")
	if err != nil {
		t.Fatal(err)
	}
	if generator.calls != 2 || result.Geometry.Name != "body" || validation.SolidCount != 1 {
		t.Fatalf("temporary CAD failure did not recover: calls=%d result=%#v validation=%#v", generator.calls, result, validation)
	}
}

func TestGenerateAICreateCADLetsAgentRepairGeometryFailure(t *testing.T) {
	agentCalls := 0
	generator := &sequenceCADGenerator{errors: []error{&aicreate.GenerationError{Kind: aicreate.GenerationGeometryFailure, Err: errors.New("boolean produced an empty solid")}}}
	app := &Server{agent: newCADRepairAgent(t, &agentCalls)}
	initial := aicreate.Blueprint{ProjectName: "Initial", Geometry: validTestFlow360Geometry("initial")}
	repaired, validation, err := app.generateAICreateCAD(context.Background(), generator, aiCreateSession{Intent: "Create cylinder flow"}, initial, filepath.Join(t.TempDir(), "body.step"), "")
	if err != nil {
		t.Fatal(err)
	}
	if generator.calls != 2 || agentCalls != 1 || repaired.ProjectName != "Repaired Cylinder" || validation.SolidCount != 1 {
		t.Fatalf("Agent CAD repair did not complete: calls=%d result=%#v", generator.calls, repaired)
	}
}

func TestGenerateAICreateCADPersistsEveryRepairAttempt(t *testing.T) {
	root := t.TempDir()
	outputPath := filepath.Join(root, "session", "body.step")
	agentCalls := 0
	diagnostic := &aicreate.CADDiagnostic{Code: "BOOLEAN_RESULT_EMPTY", OperationID: "external_fluid", Operation: "cut", Message: "empty result"}
	generator := &sequenceCADGenerator{errors: []error{&aicreate.GenerationError{Kind: aicreate.GenerationGeometryFailure, Err: errors.New("empty external fluid"), Diagnostic: diagnostic}}}
	app := &Server{agent: newCADRepairAgent(t, &agentCalls)}
	_, _, err := app.generateAICreateCAD(context.Background(), generator, aiCreateSession{Intent: "Create external flow"}, aicreate.Blueprint{ProjectName: "Initial", Geometry: validTestFlow360Geometry("initial")}, outputPath, "aip-persist-attempts")
	if err != nil {
		t.Fatal(err)
	}
	for _, attempt := range []string{"attempt-00", "attempt-01"} {
		directory := filepath.Join(root, "session", "cad-attempts", "aip-persist-attempts", attempt)
		for _, name := range []string{"blueprint.json", "recipe.json", "result.json"} {
			if _, statErr := os.Stat(filepath.Join(directory, name)); statErr != nil {
				t.Fatalf("%s did not persist %s: %v", attempt, name, statErr)
			}
		}
	}
	payload, readErr := os.ReadFile(filepath.Join(root, "session", "cad-attempts", "aip-persist-attempts", "attempt-00", "result.json"))
	if readErr != nil || !strings.Contains(string(payload), "BOOLEAN_RESULT_EMPTY") || !strings.Contains(string(payload), "failed") {
		t.Fatalf("failed attempt omitted its structured diagnostic: %s (%v)", payload, readErr)
	}
}

func TestGenerateAICreateCADCanRecoverOnThirdAgentRepair(t *testing.T) {
	agentCalls := 0
	geometryFailure := func(message string) error {
		return &aicreate.GenerationError{Kind: aicreate.GenerationGeometryFailure, Err: errors.New(message)}
	}
	generator := &sequenceCADGenerator{errors: []error{
		geometryFailure("initial boolean failure"),
		geometryFailure("repair one face selector failure"),
		geometryFailure("repair two topology failure"),
	}}
	app := &Server{agent: newCADRepairAgent(t, &agentCalls)}
	progressID := "aip-third-repair-1234"
	app.startAICreateProgress(progressID)
	initial := aicreate.Blueprint{ProjectName: "Initial", Geometry: validTestFlow360Geometry("initial")}
	repaired, validation, err := app.generateAICreateCAD(context.Background(), generator, aiCreateSession{Intent: "Create cylinder flow"}, initial, filepath.Join(t.TempDir(), "body.step"), progressID)
	if err != nil {
		t.Fatal(err)
	}
	if generator.calls != 4 || agentCalls != 3 || validation.SolidCount != 1 || repaired.ProjectName != "Repaired Cylinder" {
		t.Fatalf("expected recovery on third Agent repair: generator=%d agent=%d result=%#v", generator.calls, agentCalls, repaired)
	}
	progress := app.aiCreateProgress[progressID]
	if !strings.Contains(progress.Detail, "self-repair 3 of 3") {
		t.Fatalf("progress did not expose the real repair round: %#v", progress)
	}
}

func TestPrepareAICreateCADReusesDurableValidatedCheckpoint(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "checkpoint.step")
	step := "ISO-10303-21;\nDATA;\n#1=MANIFOLD_SOLID_BREP('checkpoint',#2);\n#2=ADVANCED_FACE('',(),#3,.T.);\nENDSEC;\nEND-ISO-10303-21;\n"
	if err := os.WriteFile(path, []byte(step), 0o600); err != nil {
		t.Fatal(err)
	}
	generator := &sequenceCADGenerator{}
	checkpoint := aiCreateCADCheckpoint{
		GeometryName: "checkpoint.step", GeometryPath: path,
		Blueprint:  aicreate.Blueprint{ProjectName: "Checkpoint", Geometry: validTestFlow360Geometry("checkpoint")},
		Validation: aicreate.GeometryValidation{SolidCount: 1, FaceCount: 3, Kernel: "checkpoint"},
	}
	app := &Server{workDir: root, cadGenerator: generator}
	progressID := "aip-cad-checkpoint-1234"
	app.startAICreateProgress(progressID)
	blueprint, validation, gotPath, gotName, err := app.prepareAICreateCAD(
		context.Background(), aiCreateSession{ID: "aic-checkpoint", CAD: &checkpoint}, progressID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if generator.calls != 0 || gotPath != path || gotName != checkpoint.GeometryName || blueprint.ProjectName != "Checkpoint" || validation.Kernel != "checkpoint" {
		t.Fatalf("durable CAD checkpoint was not reused: calls=%d path=%q name=%q blueprint=%#v validation=%#v", generator.calls, gotPath, gotName, blueprint, validation)
	}
	if !strings.Contains(app.aiCreateProgress[progressID].Detail, "Reusing") {
		t.Fatalf("checkpoint reuse was not exposed in real progress: %#v", app.aiCreateProgress[progressID])
	}
}

func TestAICreateFailureDoesNotOverwriteResumableProgress(t *testing.T) {
	app := &Server{workDir: t.TempDir()}
	progressID := "aip-resumable-progress-1234"
	if !app.startAICreateProgress(progressID) {
		t.Fatal("could not start progress")
	}
	app.finishAICreateProgress(progressID, "needs_attention", "Draft setup can be retried.", "project-1", "geometry-1")
	app.failAICreateProgressIfRunning(progressID, "generic failure")
	progress := app.aiCreateProgress[progressID]
	if progress.Status != "needs_attention" || progress.Detail != "Draft setup can be retried." {
		t.Fatalf("resumable progress was overwritten: %#v", progress)
	}
}

func TestGenerateAICreateCADStopsAfterThreeAgentRepairs(t *testing.T) {
	agentCalls := 0
	geometryFailure := func(message string) error {
		return &aicreate.GenerationError{Kind: aicreate.GenerationGeometryFailure, Err: errors.New(message)}
	}
	generator := &sequenceCADGenerator{errors: []error{
		geometryFailure("initial failure"),
		geometryFailure("repair one failed"),
		geometryFailure("repair two failed"),
		geometryFailure("ValueError: final face selector matched no faces"),
	}}
	app := &Server{agent: newCADRepairAgent(t, &agentCalls)}
	initial := aicreate.Blueprint{ProjectName: "Initial", Geometry: validTestFlow360Geometry("initial")}
	_, _, err := app.generateAICreateCAD(context.Background(), generator, aiCreateSession{Intent: "Create cylinder flow"}, initial, filepath.Join(t.TempDir(), "body.step"), "")
	if err == nil {
		t.Fatal("expected CAD repair exhaustion")
	}
	if generator.calls != 4 || agentCalls != maxAICreateCADRepairAttempts {
		t.Fatalf("repair loop exceeded its bound: generator=%d agent=%d", generator.calls, agentCalls)
	}
	message := humanizeAICreateGenerationError(err)
	if !strings.Contains(message, "tried 3 CAD self-repairs") || !strings.Contains(message, "final face selector matched no faces") {
		t.Fatalf("exhausted repair message is not actionable: %q", message)
	}
}

func TestAICreateProjectContinuesThroughStructuredClarificationRounds(t *testing.T) {
	gin.SetMode(gin.TestMode)
	requests := make([]string, 0, 2)
	agentServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, string(body))
		content := `{"version":"v1","decision":"request-input","project_name":"Cylinder Flow","summary":"","geometry":{"name":"","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[],"result":""},"simulation":{},"assumptions":[],"questions":[{"id":"diameter_m","label":"Cylinder diameter","description":"A 0.1 m baseline is practical for external flow.","type":"number","required":true,"unit":"m","default":0.1,"min":0.001,"max":100},{"id":"domain_model","label":"Domain model","description":"Spanwise symmetry is the safe baseline without a conformal periodic mesh.","type":"select","required":true,"default":"symmetry","options":[{"value":"symmetry","label":"Spanwise symmetry"},{"value":"finite","label":"Finite span"}]}]}`
		if len(requests) == 2 {
			content = `{"version":"v1","decision":"request-input","project_name":"Cylinder Flow","summary":"","geometry":{"name":"","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[],"result":""},"simulation":{},"assumptions":[],"questions":[{"id":"velocity_m_s","label":"Freestream velocity","description":"10 m/s is a stable low-speed baseline.","type":"number","required":true,"unit":"m/s","default":10,"min":0.01,"max":1000}]}`
		}
		encoded, _ := json.Marshal(content)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + string(encoded) + `}}]}`))
	}))
	defer agentServer.Close()
	app := &Server{agent: &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: agentServer.URL, Model: "test", Client: agentServer.Client()}}

	first := httptest.NewRecorder()
	firstContext, _ := gin.CreateTestContext(first)
	firstContext.Request = httptest.NewRequest(http.MethodPost, "/api/ai-create", bytes.NewBufferString(`{"intent":"Create cylinder flow","folder_id":"folder-1"}`))
	firstContext.Request.Header.Set("Content-Type", "application/json")
	app.aiCreateProject(firstContext)
	if first.Code != http.StatusOK {
		t.Fatalf("first round returned %d: %s", first.Code, first.Body.String())
	}
	var firstResponse aiCreateClarificationResponse
	if err := json.Unmarshal(first.Body.Bytes(), &firstResponse); err != nil {
		t.Fatal(err)
	}
	if firstResponse.Status != "needs_input" || firstResponse.Round != 1 || len(firstResponse.Fields) != 2 {
		t.Fatalf("unexpected first clarification: %#v", firstResponse)
	}

	secondBody, _ := json.Marshal(aiCreateRequest{
		Intent: "Create cylinder flow", FolderID: "folder-1", SessionID: firstResponse.SessionID,
		Answers: map[string]any{"diameter_m": 0.5, "domain_model": "symmetry"},
	})
	second := httptest.NewRecorder()
	secondContext, _ := gin.CreateTestContext(second)
	secondContext.Request = httptest.NewRequest(http.MethodPost, "/api/ai-create", bytes.NewReader(secondBody))
	secondContext.Request.Header.Set("Content-Type", "application/json")
	app.aiCreateProject(secondContext)
	if second.Code != http.StatusOK {
		t.Fatalf("second round returned %d: %s", second.Code, second.Body.String())
	}
	var secondResponse aiCreateClarificationResponse
	if err := json.Unmarshal(second.Body.Bytes(), &secondResponse); err != nil {
		t.Fatal(err)
	}
	if secondResponse.Round != 2 || len(secondResponse.Fields) != 1 || secondResponse.Fields[0].ID != "velocity_m_s" {
		t.Fatalf("unexpected second clarification: %#v", secondResponse)
	}
	if len(requests) != 2 || !strings.Contains(requests[1], `\"diameter_m\":0.5`) || !strings.Contains(requests[1], `\"domain_model\":\"symmetry\"`) {
		t.Fatalf("prior answers were not sent to the agent: %s", requests[1])
	}
}

func TestAICreateParameterClarificationResumesPreparedProject(t *testing.T) {
	question := agent.Question{
		Field: "operating_condition.velocity_magnitude", Message: "Freestream velocity",
		Urgency: "required", Type: "number", Unit: "m/s", Default: 10.0,
		Reason: "Sets the Reynolds number.", Recommendation: "Use 10 m/s for the baseline.",
	}
	fields := aiCreateParameterClarificationFields([]agent.Question{question})
	if len(fields) != 1 || fields[0].ID != question.Field || fields[0].Type != "number" || !fields[0].Required {
		t.Fatalf("parameter question was not preserved as a dynamic field: %#v", fields)
	}
	app := &Server{aiCreateSessions: map[string]aiCreateSession{
		"aic-ready": {
			ID: "aic-ready", Intent: "Create cylinder flow", FolderID: "folder-1", Pending: fields,
			Prepared: &aiCreatePrepared{ProjectID: "prj-existing", RootResourceID: "geo-existing"},
		},
	}}
	session, err := app.advanceAICreateSession(aiCreateRequest{
		SessionID: "aic-ready", Answers: map[string]any{question.Field: 12.5},
	})
	if err != nil {
		t.Fatal(err)
	}
	if session.Prepared == nil || session.Prepared.ProjectID != "prj-existing" || len(session.Rounds) != 1 {
		t.Fatalf("parameter clarification lost the already-created Project: %#v", session)
	}
	if session.Rounds[0].Answers[question.Field] != 12.5 {
		t.Fatalf("schema-path answer was not retained: %#v", session.Rounds[0].Answers)
	}
}

func TestValidateAICreateAnswersEnforcesTypesOptionsAndBounds(t *testing.T) {
	minimum, maximum := 0.1, 10.0
	fields := []aicreate.ClarificationField{
		{ID: "diameter", Label: "Diameter", Type: "number", Required: true, Min: &minimum, Max: &maximum},
		{ID: "mode", Label: "Domain mode", Type: "select", Required: true, Options: []aicreate.ClarificationOption{{Value: "periodic", Label: "Periodic"}, {Value: "finite", Label: "Finite"}}},
	}
	if _, err := validateAICreateAnswers(fields, map[string]any{"diameter": 0.5, "mode": "periodic"}); err != nil {
		t.Fatalf("valid answers were rejected: %v", err)
	}
	if _, err := validateAICreateAnswers(fields, map[string]any{"diameter": 50.0, "mode": "periodic"}); err == nil {
		t.Fatal("out-of-range number was accepted")
	}
	if _, err := validateAICreateAnswers(fields, map[string]any{"diameter": 0.5, "mode": "unknown"}); err == nil {
		t.Fatal("unknown select option was accepted")
	}
}

func TestAICreateSimulationParamsReadyRejectsAsyncPlaceholder(t *testing.T) {
	if aiCreateSimulationParamsReady(json.RawMessage(`{}`)) {
		t.Fatal("empty asynchronous placeholder was treated as ready")
	}
	ready := json.RawMessage(`{"simulation_params":{"version":"25.10.17","models":[{"type":"Wall"}],"private_attribute_asset_cache":{"project_entity_info":{}}}}`)
	if !aiCreateSimulationParamsReady(ready) {
		t.Fatal("complete Geometry baseline was not treated as ready")
	}
}

func TestValidateAICreateAssetRejectsSTLAsGeometry(t *testing.T) {
	root := t.TempDir()
	stlPath := filepath.Join(root, "cylinder.stl")
	if err := os.WriteFile(stlPath, []byte("solid cylinder\nfacet normal 0 0 1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateAICreateAsset(stlPath, "geometry"); err == nil {
		t.Fatal("STL was accepted as CAD Geometry")
	}
	fakeSTEP := filepath.Join(root, "renamed.step")
	if err := os.WriteFile(fakeSTEP, []byte("solid cylinder\nfacet normal 0 0 1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateAICreateAsset(fakeSTEP, "geometry"); err == nil {
		t.Fatal("renamed STL was accepted as STEP Geometry")
	}
	stepPath := filepath.Join(root, "agent-shape.step")
	step := "ISO-10303-21;\nDATA;\n#1=MANIFOLD_SOLID_BREP('shape',#2);\n#2=ADVANCED_FACE('',(),#3,.T.);\nENDSEC;\nEND-ISO-10303-21;\n"
	if err := os.WriteFile(stepPath, []byte(step), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateAICreateAsset(stepPath, "geometry"); err != nil {
		t.Fatalf("validated STEP was rejected: %v", err)
	}
}

func TestHumanizeAICreateProjectError(t *testing.T) {
	if got := humanizeAICreateProjectError(errors.New("NameResolutionError: failed to resolve host")); !strings.Contains(got, "network") {
		t.Fatalf("unexpected network error: %q", got)
	}
	if got := humanizeAICreateProjectError(errors.New("not a supported geometry or surface mesh file")); !strings.Contains(got, "CAD format") {
		t.Fatalf("unexpected CAD error: %q", got)
	}
}

func TestHumanizeAICreateDesignErrorDoesNotExposeContractDetails(t *testing.T) {
	got := humanizeAICreateDesignError(errors.New("geometry name must be a safe non-empty identifier"))
	if strings.Contains(got, "identifier") || !strings.Contains(got, "automatic repair") {
		t.Fatalf("unexpected design error: %q", got)
	}
}

func TestAICreateRoutesProviderFailureToDesignError(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "quota exceeded", http.StatusTooManyRequests)
	}))
	defer provider.Close()
	app := &Server{
		agent:   &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: provider.URL, Model: "test", Client: provider.Client()},
		workDir: t.TempDir(),
	}
	body := bytes.NewBufferString(`{"intent":"cylinder flow at several Reynolds numbers","folder_id":"folder-1"}`)
	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Request = httptest.NewRequest(http.MethodPost, "/api/ai-create", body)
	requestContext.Request.Header.Set("Content-Type", "application/json")

	app.aiCreateProject(requestContext)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	message := recorder.Body.String()
	if !strings.Contains(message, "rate-limited or out of quota") || strings.Contains(message, "exact CAD") || strings.Contains(message, "self-repair") {
		t.Fatalf("provider failure was mislabeled as CAD generation: %s", message)
	}
}

func TestHumanizeAICreateGenerationErrorDoesNotExposeRuntimePaths(t *testing.T) {
	err := &aicreate.GenerationError{Kind: aicreate.GenerationTemporaryFailure, Err: errors.New("can't open /private/runtime/generate_cad.py")}
	got := humanizeAICreateGenerationError(err)
	if strings.Contains(got, "/private/") || !strings.Contains(got, "retrying") {
		t.Fatalf("unexpected generation error: %q", got)
	}
}

func TestHumanizeAICreateGenerationErrorExplainsRuntimeDiscoveryAndDependencyFailures(t *testing.T) {
	missing := &aicreate.GenerationError{Kind: aicreate.GenerationRuntimeFailure, Err: errors.New("CAD runtime uv was not found")}
	if got := humanizeAICreateGenerationError(missing); !strings.Contains(got, "application directory") || !strings.Contains(got, "VIBESIM_UV_BINARY") {
		t.Fatalf("missing runtime diagnostic is not actionable: %q", got)
	}
	dependency := &aicreate.GenerationError{Kind: aicreate.GenerationRuntimeFailure, Err: errors.New("ModuleNotFoundError: No module named 'cadquery'")}
	if got := humanizeAICreateGenerationError(dependency); !strings.Contains(got, "make cad-runtime") || !strings.Contains(got, "VIBESIM_UV_CACHE_DIR") {
		t.Fatalf("dependency diagnostic is not actionable: %q", got)
	}
	python := &aicreate.GenerationError{Kind: aicreate.GenerationRuntimeFailure, Err: errors.New("current Python version (3.9.6) does not satisfy Python>=3.10")}
	if got := humanizeAICreateGenerationError(python); !strings.Contains(got, "Python 3.11") || !strings.Contains(got, "VIBESIM_CAD_PYTHON") {
		t.Fatalf("Python runtime diagnostic is not actionable: %q", got)
	}
}
