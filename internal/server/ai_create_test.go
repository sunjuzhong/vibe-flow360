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

func TestAICreateProjectGeneratesProjectAndCasePlan(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	agentServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"version\":\"v1\",\"decision\":\"generate\",\"project_name\":\"Agent Flow Geometry\",\"summary\":\"Agent-designed external-flow geometry.\",\"geometry\":{\"name\":\"agent-body\",\"unit\":\"m\",\"representation\":\"analytic-brep\",\"format\":\"step\",\"generator\":\"cadquery-dsl-v1\",\"operations\":[{\"id\":\"body\",\"op\":\"box\",\"params\":{\"length\":2,\"width\":1,\"height\":0.5}}],\"result\":\"body\"},\"simulation\":{\"velocity_m_s\":10,\"alpha_deg\":0,\"surface_edge_length_m\":0.03,\"first_layer_thickness_m\":0.000025,\"max_steps\":10000},\"assumptions\":[\"Review inferred values.\"],\"questions\":[]}"}}]}`))
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
    printf '%s' '{"simulation_params":{"version":"25.10.17","unit_system":{"name":"SI"},"meshing":{"defaults":{}},"models":[{"type":"Wall","entities":{"stored_entities":[{"name":"*"}]}},{"type":"Freestream"},{"type":"Fluid"}],"private_attribute_asset_cache":{"project_entity_info":{"face_group_tag":"faceId","grouped_faces":[[{"name":"cylinder-side","private_attribute_id":"face-1","private_attribute_tag_key":"faceId","private_attribute_entity_type_name":"Surface","private_attribute_sub_components":["face-1"]}]]}}}}'
    ;;
  *" geometry info geometry-ai-1 "*|*" geometry state geometry-ai-1 "*|*" geometry summary geometry-ai-1 "*)
    printf '%s' '{}'
    ;;
  *) exit 8 ;;
esac
`
	if err := os.WriteFile(fakeFlow360, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	preflightScript := `#!/bin/sh
printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{},"required":[]},"editor_schemas":{"SurfaceMesh":{"type":"object","properties":{}},"VolumeMesh":{"type":"object","properties":{}},"Case":{"type":"object","properties":{}}}}'
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

	body := bytes.NewBufferString(`{"intent":"帮我实现一个圆柱扰流的仿真试验","folder_id":"folder-1"}`)
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
	if response.Plan.Target != "case" || response.Plan.ProjectID != response.ProjectID || len(response.Plan.Patch) == 0 {
		t.Fatalf("expected preloaded Case plan: %#v", response.Plan)
	}
	if response.Plan.Preflight == nil || !response.Plan.Preflight.Valid {
		t.Fatalf("expected schema-valid generated parameters: %#v", response.Plan.Preflight)
	}
	var patch map[string]any
	if err := json.Unmarshal(response.Plan.Patch, &patch); err != nil {
		t.Fatal(err)
	}
	models := patch["models"].([]any)
	wall := models[0].(map[string]any)
	entities := wall["entities"].(map[string]any)["stored_entities"].([]any)
	if len(entities) != 1 || entities[0].(map[string]any)["name"] != "cylinder-side" {
		t.Fatalf("expected concrete CAD Wall assignment: %#v", entities)
	}
	if _, err := os.Stat(filepath.Join(root, "ai-create")); err != nil {
		t.Fatalf("expected durable staging root: %v", err)
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

func TestAICreateProjectContinuesThroughStructuredClarificationRounds(t *testing.T) {
	gin.SetMode(gin.TestMode)
	requests := make([]string, 0, 2)
	agentServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, string(body))
		content := `{"version":"v1","decision":"request-input","project_name":"Cylinder Flow","summary":"","geometry":{"name":"","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[],"result":""},"simulation":{},"assumptions":[],"questions":[{"id":"diameter_m","label":"Cylinder diameter","description":"Reference diameter","type":"number","required":true,"unit":"m","min":0.001,"max":100},{"id":"domain_model","label":"Domain model","type":"select","required":true,"options":[{"value":"periodic","label":"Thin periodic"},{"value":"finite","label":"Finite span"}]}]}`
		if len(requests) == 2 {
			content = `{"version":"v1","decision":"request-input","project_name":"Cylinder Flow","summary":"","geometry":{"name":"","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[],"result":""},"simulation":{},"assumptions":[],"questions":[{"id":"velocity_m_s","label":"Freestream velocity","type":"number","required":true,"unit":"m/s","min":0.01,"max":1000}]}`
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
		Answers: map[string]any{"diameter_m": 0.5, "domain_model": "periodic"},
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
	if len(requests) != 2 || !strings.Contains(requests[1], `\"diameter_m\":0.5`) || !strings.Contains(requests[1], `\"domain_model\":\"periodic\"`) {
		t.Fatalf("prior answers were not sent to the agent: %s", requests[1])
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
