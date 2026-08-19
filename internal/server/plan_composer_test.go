package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func TestPlanAssistAgentErrorClassifiesTimeoutAsRetryable(t *testing.T) {
	status, payload := planAssistAgentError(&agent.GenerationTimeoutError{
		Provider: "external Codex",
		After:    5 * time.Minute,
	})
	if status != http.StatusGatewayTimeout || payload["code"] != "ai_timeout" || payload["retryable"] != true {
		t.Fatalf("unexpected timeout response: status=%d payload=%#v", status, payload)
	}
	message, _ := payload["error"].(string)
	if !strings.Contains(message, "No form values were changed") || !strings.Contains(message, "retry") {
		t.Fatalf("timeout response is not actionable: %q", message)
	}

	status, payload = planAssistAgentError(errors.New("invalid action"))
	if status != http.StatusBadGateway || payload["code"] != nil {
		t.Fatalf("non-timeout error was misclassified: status=%d payload=%#v", status, payload)
	}
}

func TestPlanAssistRepairPromptIncludesExactIssuesAndRemovalSemantics(t *testing.T) {
	prompt := planAssistRepairPrompt(
		planComposerRequest{SourceType: "Geometry", Target: "case", Intent: "basic cylinder flow"},
		agent.Proposal{Patch: json.RawMessage(`{"time_stepping":{"type_name":"Unsteady"}}`)},
		flow360.PreflightResult{Issues: []flow360.PreflightIssue{
			{Level: "error", Code: "missing", Path: "time_stepping.steps", Message: "Field required"},
			{Level: "error", Code: "extra_forbidden", Path: "time_stepping.max_steps", Message: "Extra inputs are not permitted"},
		}},
		1,
	)
	for _, expected := range []string{
		"time_stepping.steps", "time_stepping.max_steps", "Use unset to remove an obsolete field",
		"Resolve every listed issue", "corrective path-level operations",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("repair prompt is missing %q: %s", expected, prompt)
		}
	}
	if !strings.Contains(prompt, "Use the language of the Original intent") {
		t.Fatalf("repair prompt does not preserve the user's language: %s", prompt)
	}
}

func TestPlanAssistIssueContextPreservesSchemaPaths(t *testing.T) {
	context := planAssistIssueContext([]flow360.PreflightIssue{
		{Path: "meshing.volume_zones", Message: "A required value is missing."},
		{Message: "The selected model is inconsistent with its entities."},
	})
	if len(context) != 2 || context[0] != "meshing.volume_zones: A required value is missing." || context[1] != "The selected model is inconsistent with its entities." {
		t.Fatalf("preflight evidence lost schema context: %#v", context)
	}
}

func TestPlanComposerDraftCanSupplyBaselineWhenSourceHasNoSimulationParams(t *testing.T) {
	draft := json.RawMessage(`{"version":"25.10.18"}`)
	baseline, err := planComposerBaseline(nil, draft, true)
	if err != nil {
		t.Fatal(err)
	}
	if string(baseline) != string(draft) {
		t.Fatalf("Draft baseline was not selected: %s", baseline)
	}
	if _, err := planComposerBaseline(nil, nil, false); err == nil || !strings.Contains(err.Error(), "source SimulationParams") {
		t.Fatalf("missing source baseline returned the wrong error: %v", err)
	}
	if _, err := planComposerBaseline(json.RawMessage(`{}`), nil, true); err == nil || !strings.Contains(err.Error(), "Draft SimulationParams") {
		t.Fatalf("missing requested Draft baseline returned the wrong error: %v", err)
	}
}

func TestPlanComposerDraftIdentityAuthorizesMissingSourceInfo(t *testing.T) {
	request := planComposerRequest{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry", SourceName: "Cached Geometry",
	}
	draftInfo := map[string]any{
		"project_id":       "prj-1",
		"source_item_id":   "geo-1",
		"source_item_type": "Geometry",
	}
	if err := validatePlanComposerDraftIdentity(request, draftInfo); err != nil {
		t.Fatal(err)
	}
	name, err := planComposerSourceName(request, nil, true)
	if err != nil || name != "Cached Geometry" {
		t.Fatalf("verified Draft could not tolerate unavailable source info: name=%q err=%v", name, err)
	}
	if _, err := planComposerSourceName(request, nil, false); err == nil || !strings.Contains(err.Error(), "source metadata") {
		t.Fatalf("unverified resource request accepted missing source info: %v", err)
	}
}

func TestPlanComposerDraftIdentityRejectsMismatchedProjectSourceAndType(t *testing.T) {
	request := planComposerRequest{ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry"}
	valid := map[string]any{"project_id": "prj-1", "source_item_id": "geo-1", "source_item_type": "Geometry"}
	for field, value := range map[string]any{
		"project_id":       "prj-other",
		"source_item_id":   "geo-other",
		"source_item_type": "Case",
	} {
		candidate := make(map[string]any, len(valid))
		for key, original := range valid {
			candidate[key] = original
		}
		candidate[field] = value
		if err := validatePlanComposerDraftIdentity(request, candidate); err == nil {
			t.Fatalf("Draft identity mismatch %s=%v was accepted", field, value)
		}
	}
	if _, err := planComposerSourceName(request, json.RawMessage(`{"project_id":"prj-other","name":"Wrong"}`), true); err == nil {
		t.Fatal("explicit conflicting source metadata was ignored")
	}
}

func TestPreparePlanAssistProposalAllowsMergePatchRemoval(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"time_stepping":{"type":"object","properties":{"steps":{"type":"integer"},"step_size":{"type":"quantity","unit":"s","value_schema":{"type":"number"}},"max_steps":{"type":"json"}}}}}`)
	composer := planComposerContext{
		Request: planComposerRequest{ProjectID: "prj", ProjectName: "Project", SourceID: "geo", SourceType: "Geometry", Target: "case", Intent: "baseline"},
		Name:    "Geometry",
	}
	action := agent.Action{Proposals: []agent.Proposal{{
		SourceType: "Geometry", Target: "case", Name: "Baseline", Intent: "baseline",
		Patch: json.RawMessage(`{"time_stepping":{"steps":2000,"step_size":{"value":0.005,"units":"s"},"max_steps":null}}`),
	}}}
	proposal, err := preparePlanAssistProposal(action, composer, schema)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(proposal.Patch), `"max_steps":null`) {
		t.Fatalf("merge-patch removal was lost: %s", proposal.Patch)
	}
}

func TestPreparePlanAssistProposalNormalizesDraftUpdateForPreflight(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"outputs":{"type":"array","items":{"type":"object"}}}}`)
	composer := planComposerContext{
		Request: planComposerRequest{
			ProjectID: "prj", SourceID: "geo", SourceType: "Geometry", DraftID: "draft-1", Target: "case", Intent: "add outputs",
		},
		Name: "Geometry",
	}
	action := agent.Action{Kind: agent.ActionUpdateDraft, Proposals: []agent.Proposal{{
		ID: "edit-1", DraftID: "draft-1", Target: "draft", Name: "Add outputs", Intent: "add outputs",
		Patch: json.RawMessage(`{"outputs":[]}`),
	}}}
	proposal, err := preparePlanAssistProposal(action, composer, schema)
	if err != nil {
		t.Fatal(err)
	}
	if proposal.SourceType != "Geometry" || proposal.Target != "case" || proposal.DraftID != "draft-1" {
		t.Fatalf("Draft proposal was not normalized onto the validation route: %#v", proposal)
	}
}

func TestPreparePlanAssistProposalRemovesCanonicalReferenceAreaDiscriminator(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"reference_geometry":{"type":"object","properties":{"area":{"type":"union","variants":[{"type":"quantity","unit_options":["m**2"],"value_schema":{"type":"number"}},{"type":"string"}]}}}}}`)
	composer := planComposerContext{Request: planComposerRequest{
		ProjectID: "prj", ProjectName: "Cylinder", SourceID: "geo", SourceType: "Geometry", Target: "case", Intent: "Re=3900 cylinder flow",
	}, Name: "Geometry"}
	action := agent.Action{Proposals: []agent.Proposal{{
		SourceType: "Geometry", Target: "case", Name: "Cylinder", Intent: "Re=3900 cylinder flow",
		Patch: json.RawMessage(`{"reference_geometry":{"area":{"type_name":"number","value":1,"units":"m**2"}}}`),
	}}}
	proposal, err := preparePlanAssistProposal(action, composer, schema)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(proposal.Patch), "type_name") || !strings.Contains(string(proposal.Patch), `"units":"m**2"`) {
		t.Fatalf("reference area was not projected onto the editable schema: %s", proposal.Patch)
	}
	if len(proposal.ValidationHints) != 1 || !strings.Contains(proposal.ValidationHints[0], "reference_geometry.area.type_name") {
		t.Fatalf("sanitization was not auditable: %#v", proposal.ValidationHints)
	}
}

func TestRecommendedQuestionDefaultsLetsAutonomousAICreateAcceptReynoldsNumber(t *testing.T) {
	defaults, ok := recommendedQuestionDefaults([]agent.Question{{
		Field: "target_reynolds_number", Message: "Target Reynolds number", Type: "select", Default: "3900",
		Options: []agent.QuestionOption{{Value: "3900", Label: "Re = 3900"}},
	}})
	if !ok || defaults["target_reynolds_number"] != "3900" {
		t.Fatalf("recommended Reynolds number was not autonomously resolvable: %#v", defaults)
	}
	if _, ok := recommendedQuestionDefaults([]agent.Question{{Field: "unknown_physics", Default: nil}}); ok {
		t.Fatal("a consequential choice without a default must still reach the user")
	}
	confirmed, ok := authoritativeQuestionValues(
		[]agent.Question{{Field: "target_reynolds_number", Type: "select"}},
		json.RawMessage(`{"target_reynolds_number":"3900"}`),
	)
	if !ok || confirmed["target_reynolds_number"] != "3900" {
		t.Fatalf("an already confirmed Reynolds number was not authoritative: %#v", confirmed)
	}
	if _, ok := recommendedQuestionDefaults([]agent.Question{{
		Field: "target_reynolds_number", Type: "select", Default: "unsupported",
		Options: []agent.QuestionOption{{Value: "3900", Label: "Re = 3900"}},
	}}); ok {
		t.Fatal("an invalid recommended default must not be accepted autonomously")
	}
}

func TestResolveAutonomousPlanAssistQuestionsContinuesWithRecommendedReynoldsNumber(t *testing.T) {
	var requestBody string
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		requestBody = string(body)
		content := `{"version":"v1","kind":"create-plan","message":"Configured Re=3900 autonomously.","proposals":[{"id":"cylinder","action":"Geometry","target":"case","name":"Cylinder","intent":"Run Re=3900","patch":{"time_stepping":{"max_steps":2000}},"branch_preview":"cylinder","fields":[]}],"questions":[],"warnings":[],"assumptions":["Accepted the recommended Re=3900 baseline."]}`
		encoded, _ := json.Marshal(content)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + string(encoded) + `}}]}`))
	}))
	defer model.Close()
	app := &Server{agent: &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: model.URL, Model: "test", Client: model.Client()}}
	initial := &agent.Action{Version: "v1", Kind: agent.ActionRequestMissingInput, Message: "Confirm Re", Questions: []agent.Question{{
		Field: "target_reynolds_number", Message: "Target Reynolds number", Urgency: "required", Type: "select", Default: "3900",
		Options: []agent.QuestionOption{{Value: "3900", Label: "Re = 3900"}},
	}}}
	resolved, err := app.resolveAutonomousPlanAssistQuestions(context.Background(), planComposerContext{
		Request: planComposerRequest{Autonomous: true, SourceType: "Geometry", Target: "case"},
	}, []byte(`{"form_schema":{"fields":[]}}`), initial)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Kind != agent.ActionCreatePlan || !strings.Contains(requestBody, `target_reynolds_number`) || !strings.Contains(requestBody, `3900`) {
		t.Fatalf("autonomous continuation did not apply the recommendation: action=%#v request=%s", resolved, requestBody)
	}
}

func TestResolveAutonomousPlanAssistQuestionsStopsBeforeRetryingConfirmedField(t *testing.T) {
	app := &Server{}
	initial := &agent.Action{Version: "v1", Kind: agent.ActionRequestMissingInput, Message: "Choose boundary treatment", Questions: []agent.Question{{
		Field: "models", Message: "Choose boundary treatment.", Urgency: "required", Type: "text",
	}}}
	resolved, err := app.resolveAutonomousPlanAssistQuestions(context.Background(), planComposerContext{
		Request: planComposerRequest{
			Autonomous: true, SourceType: "Case", Target: "case",
			ConfirmedInputs: json.RawMessage(`{"models":"keep wall boundaries and rebuild the mesh"}`),
		},
	}, []byte(`{"form_schema":{"fields":[]}}`), initial)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Kind != agent.ActionRequestMissingInput {
		t.Fatalf("a repeated confirmed question should be returned without another model call: %#v", resolved)
	}
}

func TestGenerateSchemaNativePlanRejectsMechanicalQuestionsAndRepairsOnThirdAttempt(t *testing.T) {
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	preflightScript := `#!/bin/sh
if grep -q '"required_value":true' "$3"; then
  valid=true
  issues='[]'
else
  valid=false
  issues='[{"level":"error","code":"missing","path":"required_value","message":"A schema-required value is missing.","stages":["Case"]}]'
fi
printf '{"schema_version":1,"validator_version":"test","valid":%s,"issues":%s,"form_schema":{"type":"object","properties":{"required_value":{"type":"boolean"}}},"editor_schemas":{"SurfaceMesh":{"type":"object","properties":{"required_value":{"type":"boolean"}}},"VolumeMesh":{"type":"object","properties":{"required_value":{"type":"boolean"}}},"Case":{"type":"object","properties":{"required_value":{"type":"boolean"}}}}}' "$valid" "$issues"
`
	if err := os.WriteFile(fakePython, []byte(preflightScript), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)

	modelCalls := 0
	modelRequests := make([]string, 0, 4)
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		modelCalls++
		body, _ := io.ReadAll(request.Body)
		modelRequests = append(modelRequests, string(body))
		content := `{"version":"v1","kind":"create-plan","message":"Initial candidate.","proposals":[{"id":"generic","action":"Geometry","target":"case","name":"Generic setup","intent":"ready to run","patch":{"required_value":false},"branch_preview":"generic","fields":[]}],"questions":[],"warnings":[],"assumptions":[]}`
		if modelCalls == 2 || modelCalls == 3 {
			content = `{"version":"v1","kind":"request-missing-input","message":"Please configure the missing schema field.","questions":[{"field":"required_value","message":"Choose the required configuration value.","urgency":"required"}]}`
		}
		if modelCalls == 4 {
			content = `{"version":"v1","kind":"create-plan","message":"Repaired from schema evidence.","proposals":[{"id":"generic","action":"Geometry","target":"case","name":"Generic setup","intent":"ready to run","patch":{"required_value":true},"branch_preview":"generic","fields":[]}],"questions":[],"warnings":[],"assumptions":[]}`
		}
		encoded, _ := json.Marshal(content)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + string(encoded) + `}}]}`))
	}))
	defer model.Close()

	schema := json.RawMessage(`{"type":"object","properties":{"required_value":{"type":"boolean"}}}`)
	app := &Server{
		agent:   &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: model.URL, Model: "test", Client: model.Client()},
		flow360: &flow360.Client{Binary: "flow360"},
	}
	result, err := app.generateSchemaNativePlan(context.Background(), planComposerContext{
		Request: planComposerRequest{
			ProjectID: "prj", SourceID: "geo", SourceType: "Geometry", Target: "case",
			Intent: "Build a ready-to-run setup.", Prompt: "Complete all configuration autonomously.", Autonomous: true,
		},
		Name: "Geometry", Baseline: json.RawMessage(`{}`),
		Form: flow360.PlanFormSchema{
			Stages:  []string{"SurfaceMesh", "VolumeMesh", "Case"},
			Schemas: map[string]json.RawMessage{"SurfaceMesh": schema, "VolumeMesh": schema, "Case": schema},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if modelCalls != 4 || result.RepairAttempts != 3 {
		t.Fatalf("expected initial generation plus three bounded repairs, calls=%d repairs=%d", modelCalls, result.RepairAttempts)
	}
	if result.Preflight == nil || !result.Preflight.Valid || result.Proposal == nil || !strings.Contains(string(result.Proposal.Patch), `"required_value":true`) {
		t.Fatalf("third repair did not produce a valid generic setup: %#v", result)
	}
	if result.Action.Kind == agent.ActionRequestMissingInput {
		t.Fatal("schema-mechanical questions escaped to the user")
	}
	joinedRequests := strings.Join(modelRequests, "\n")
	for _, expected := range []string{"flow360-parameter-authoring", "flow360-preflight-repair", "runtime_skills"} {
		if !strings.Contains(joinedRequests, expected) {
			t.Fatalf("stage-scoped runtime skill %q did not reach the model context", expected)
		}
	}
}

func TestGenerateSchemaNativePlanRestoresMissingDraftArrayMembersBeforeAgentRepair(t *testing.T) {
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	preflightScript := `#!/bin/sh
if grep -q '"entities"' "$3"; then
  valid=true
  issues='[]'
else
  valid=false
  issues='[{"level":"error","code":"missing","path":"meshing.refinements.0.entities","message":"Field required","stages":["SurfaceMesh","VolumeMesh"]}]'
fi
printf '{"schema_version":1,"validator_version":"test","valid":%s,"issues":%s,"form_schema":{"type":"object","properties":{}},"editor_schemas":{"SurfaceMesh":{"type":"object","properties":{"meshing":{"type":"object"}}}}}' "$valid" "$issues"
`
	if err := os.WriteFile(fakePython, []byte(preflightScript), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)

	modelCalls := 0
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		modelCalls++
		content := `{"version":"v1","kind":"update-draft","message":"Updated the mesh size.","proposals":[{"id":"edit","draft_id":"draft-1","target":"draft","name":"Draft edit","intent":"complete it","operations":[{"op":"set","path":"/meshing/refinements/0/max_edge_length","value":0.1}],"branch_preview":"edit","fields":[]}],"questions":[],"warnings":[],"assumptions":[]}`
		encoded, _ := json.Marshal(content)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + string(encoded) + `}}]}`))
	}))
	defer model.Close()

	schema := json.RawMessage(`{"type":"object","properties":{"meshing":{"type":"object","properties":{"refinements":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"type":{"type":"string"},"entities":{"type":"json"},"max_edge_length":{"type":"number"}}}}}}}}`)
	app := &Server{
		agent:   &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: model.URL, Model: "test", Client: model.Client()},
		flow360: &flow360.Client{Binary: "flow360"},
	}
	result, err := app.generateSchemaNativePlan(context.Background(), planComposerContext{
		Request: planComposerRequest{
			ProjectID: "prj", SourceID: "geo", SourceType: "Geometry", DraftID: "draft-1", Target: "case",
			Intent: "complete it", Prompt: "complete it", Autonomous: true,
		},
		Name:             "Geometry",
		Baseline:         json.RawMessage(`{"meshing":{"refinements":[{"name":"Main element","type":"SurfaceRefinement"}]}}`),
		RecoveryBaseline: json.RawMessage(`{"meshing":{"refinements":[{"name":"Main element","type":"SurfaceRefinement","entities":{"stored_entities":[{"name":"wall"}]},"max_edge_length":0.2}]}}`),
		Form:             flow360.PlanFormSchema{Stages: []string{"SurfaceMesh"}, Schemas: map[string]json.RawMessage{"SurfaceMesh": schema}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if modelCalls != 1 || result.RepairAttempts != 1 || !result.AutoRepaired || result.Preflight == nil || !result.Preflight.Valid {
		t.Fatalf("persisted Draft recovery did not avoid model repair: calls=%d result=%#v", modelCalls, result)
	}
	for _, expected := range []string{`"entities":{"stored_entities":[{"name":"wall"}]}`, `"max_edge_length":0.1`} {
		if result.Proposal == nil || !strings.Contains(string(result.Proposal.Patch), expected) {
			t.Fatalf("recovered Draft patch is missing %s: %#v", expected, result.Proposal)
		}
	}
}

func TestGenerateSchemaNativePlanRemovesContextRejectedFieldBeforeAgentRepair(t *testing.T) {
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	preflightScript := `#!/bin/sh
if grep -q '"resolve_face_boundaries":true' "$3"; then
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"value_error","path":"meshing.refinements.0.resolve_face_boundaries","message":"Value error, resolve_face_boundaries is only supported when geometry AI is used.","stages":["SurfaceMesh","VolumeMesh"]},{"level":"error","code":"value_error","path":"meshing.refinements.1.resolve_face_boundaries","message":"Value error, resolve_face_boundaries is only supported when geometry AI is used.","stages":["SurfaceMesh","VolumeMesh"]}],"form_schema":{"type":"object","properties":{}},"editor_schemas":{"SurfaceMesh":{"type":"object","properties":{"meshing":{"type":"object"}}}}}'
else
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{}},"editor_schemas":{"SurfaceMesh":{"type":"object","properties":{"meshing":{"type":"object"}}}}}'
fi
`
	if err := os.WriteFile(fakePython, []byte(preflightScript), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)

	modelCalls := 0
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		modelCalls++
		content := `{"version":"v1","kind":"update-draft","message":"Completed the setup.","proposals":[{"id":"edit","draft_id":"draft-1","target":"draft","name":"Draft edit","intent":"complete it","operations":[{"op":"set","path":"/meshing/refinements/0/resolve_face_boundaries","value":true},{"op":"set","path":"/meshing/refinements/1/resolve_face_boundaries","value":true}],"branch_preview":"edit","fields":[]}],"questions":[],"warnings":[],"assumptions":[]}`
		encoded, _ := json.Marshal(content)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + string(encoded) + `}}]}`))
	}))
	defer model.Close()

	schema := json.RawMessage(`{"type":"object","properties":{"meshing":{"type":"object","properties":{"refinements":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"refinement_type":{"type":"string"},"max_edge_length":{"type":"json"},"resolve_face_boundaries":{"type":"boolean"}}}}}}}}`)
	app := &Server{
		agent:   &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: model.URL, Model: "test", Client: model.Client()},
		flow360: &flow360.Client{Binary: "flow360"},
	}
	result, err := app.generateSchemaNativePlan(context.Background(), planComposerContext{
		Request: planComposerRequest{
			ProjectID: "prj", SourceID: "geo", SourceType: "Geometry", DraftID: "draft-1", Target: "case",
			Intent: "complete it", Prompt: "complete it", Autonomous: true,
		},
		Name: "Geometry", Baseline: json.RawMessage(`{"meshing":{"refinements":[{"name":"Main element","refinement_type":"SurfaceRefinement","max_edge_length":{"value":0.04,"units":"m"}},{"name":"Slat and flap","refinement_type":"SurfaceRefinement","max_edge_length":{"value":0.025,"units":"m"}}]}}`),
		Form: flow360.PlanFormSchema{Stages: []string{"SurfaceMesh"}, Schemas: map[string]json.RawMessage{"SurfaceMesh": schema}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if modelCalls != 1 || result.RepairAttempts != 1 || !result.AutoRepaired || result.Preflight == nil || !result.Preflight.Valid {
		t.Fatalf("contextual validator repair did not converge without another model call: calls=%d result=%#v", modelCalls, result)
	}
	if result.Proposal == nil || strings.Contains(string(result.Proposal.Patch), `"resolve_face_boundaries"`) {
		t.Fatalf("context-rejected field survived in proposal: %#v", result.Proposal)
	}
	for _, preserved := range []string{`"name":"Main element"`, `"name":"Slat and flap"`, `"max_edge_length"`} {
		if !strings.Contains(string(result.Proposal.Patch), preserved) {
			t.Fatalf("valid refinement data was lost while removing contextual field %s: %s", preserved, result.Proposal.Patch)
		}
	}
}

func TestGenerateSchemaNativePlanAppliesOperationsWithoutLosingUnionTags(t *testing.T) {
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	preflightScript := `#!/bin/sh
if grep -q '"type_name":"NavierStokesInitialCondition"' "$3" && grep -q '"type_name":"SpalartAllmaras"' "$3" && grep -q '"absolute_tolerance":1e-8' "$3"; then
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{}},"editor_schemas":{"Case":{"type":"object","properties":{"models":{"type":"array"}}}}}'
else
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"union_tag_not_found","path":"models.0.turbulence_model_solver","message":"Unable to extract tag using discriminator type_name","stages":["Case"]}],"form_schema":{"type":"object","properties":{}},"editor_schemas":{"Case":{"type":"object","properties":{"models":{"type":"array"}}}}}'
fi
`
	if err := os.WriteFile(fakePython, []byte(preflightScript), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)

	modelCalls := 0
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		modelCalls++
		content := `{"version":"v1","kind":"update-draft","message":"Updated one solver value.","proposals":[{"id":"edit","draft_id":"draft-1","target":"draft","name":"Solver edit","intent":"tighten tolerance","operations":[{"op":"set","path":"/models/0/turbulence_model_solver/absolute_tolerance","value":1e-8}],"branch_preview":"edit","fields":[]}],"questions":[],"warnings":[],"assumptions":[]}`
		encoded, _ := json.Marshal(content)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + string(encoded) + `}}]}`))
	}))
	defer model.Close()

	schema := json.RawMessage(`{"type":"object","properties":{"models":{"type":"array","items":{"type":"object","properties":{"turbulence_model_solver":{"type":"object","properties":{"absolute_tolerance":{"type":"number"}}}}}}}}`)
	baseline := json.RawMessage(`{"models":[{"type":"Fluid","initial_condition":{"type_name":"NavierStokesInitialCondition","rho":1.0},"turbulence_model_solver":{"type_name":"SpalartAllmaras","absolute_tolerance":1e-7}}]}`)
	app := &Server{
		agent:   &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: model.URL, Model: "test", Client: model.Client()},
		flow360: &flow360.Client{Binary: "flow360"},
	}
	result, err := app.generateSchemaNativePlan(context.Background(), planComposerContext{
		Request: planComposerRequest{
			ProjectID: "prj", SourceID: "geo", SourceType: "Geometry", DraftID: "draft-1", Target: "case",
			Intent: "tighten tolerance", Prompt: "tighten tolerance", Autonomous: true,
		},
		Name: "Geometry", Baseline: baseline,
		Form: flow360.PlanFormSchema{Stages: []string{"Case"}, Schemas: map[string]json.RawMessage{"Case": schema}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if modelCalls != 1 || result.Preflight == nil || !result.Preflight.Valid || result.Proposal == nil {
		t.Fatalf("operation-based Draft update did not validate directly: calls=%d result=%#v", modelCalls, result)
	}
	for _, expected := range []string{`"type_name":"NavierStokesInitialCondition"`, `"type_name":"SpalartAllmaras"`, `"absolute_tolerance":1e-8`} {
		if !strings.Contains(string(result.Proposal.Patch), expected) {
			t.Fatalf("compiled review patch lost canonical union content %s: %s", expected, result.Proposal.Patch)
		}
	}
}

func TestGenerateSchemaNativePlanReappliesFinalDeterministicBoundaryRepair(t *testing.T) {
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	preflightScript := `#!/bin/sh
has_required=false
has_boundary=false
grep -q '"required_value":true' "$3" && has_required=true
grep -q '"type":"SymmetryPlane"' "$3" && has_boundary=true
if [ "$has_required" = true ] && [ "$has_boundary" = true ]; then
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{}},"editor_schemas":{"SurfaceMesh":{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}},"VolumeMesh":{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}},"Case":{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}}}}'
elif [ "$has_boundary" = false ]; then
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"value_error","path":"models","message":"One imported ghost boundary is unassigned.","stages":["Case"]}],"form_schema":{"type":"object","properties":{"models":{"type":"entity_assignment","model_choices":[{"value":"new:SymmetryPlane","model_type":"SymmetryPlane","entity_property":"surfaces"}],"entity_choices":[{"value":"ghost-17","payload":{"name":"ghost-17","private_attribute_id":"entity-17","private_attribute_entity_type_name":"GhostCircularPlane"}}],"default_model":"new:SymmetryPlane","default_entities":["ghost-17"],"recommendation":{"confidence":"high","provenance":"flow360_schema_validation"}}}},"editor_schemas":{"SurfaceMesh":{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}},"VolumeMesh":{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}},"Case":{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}}}}'
else
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"missing","path":"required_value","message":"A required setting is missing.","stages":["Case"]}],"form_schema":{"type":"object","properties":{"required_value":{"type":"boolean"}}},"editor_schemas":{"SurfaceMesh":{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}},"VolumeMesh":{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}},"Case":{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}}}}'
fi
`
	if err := os.WriteFile(fakePython, []byte(preflightScript), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)

	modelCalls := 0
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		modelCalls++
		required := "false"
		if modelCalls == 4 {
			required = "true"
		}
		content := `{"version":"v1","kind":"create-plan","message":"Repair candidate.","proposals":[{"id":"generic","action":"Geometry","target":"case","name":"Generic","intent":"ready","operations":[{"op":"set","path":"/required_value","value":` + required + `}],"branch_preview":"generic","fields":[]}],"questions":[],"warnings":[],"assumptions":[]}`
		encoded, _ := json.Marshal(content)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + string(encoded) + `}}]}`))
	}))
	defer model.Close()

	schema := json.RawMessage(`{"type":"object","properties":{"required_value":{"type":"boolean"},"models":{"type":"array"}}}`)
	app := &Server{
		agent:   &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: model.URL, Model: "test", Client: model.Client()},
		flow360: &flow360.Client{Binary: "flow360"},
	}
	result, err := app.generateSchemaNativePlan(context.Background(), planComposerContext{
		Request: planComposerRequest{ProjectID: "prj", SourceID: "geo", SourceType: "Geometry", Target: "case", Intent: "Build a ready setup.", Autonomous: true},
		Name:    "Geometry", Baseline: json.RawMessage(`{"models":[{"type":"Wall"}]}`),
		Form: flow360.PlanFormSchema{Stages: []string{"Case"}, Schemas: map[string]json.RawMessage{"Case": schema}},
	})
	if err != nil {
		t.Fatalf("generation failed after %d model calls: %v", modelCalls, err)
	}
	if modelCalls != 4 || result.Preflight == nil || !result.Preflight.Valid || result.Proposal == nil {
		t.Fatalf("final deterministic repair did not recover the setup: calls=%d result=%#v", modelCalls, result)
	}
	for _, expected := range []string{`"required_value":true`, `"type":"SymmetryPlane"`, `"name":"ghost-17"`} {
		if !strings.Contains(string(result.Proposal.Patch), expected) {
			t.Fatalf("final repaired patch is missing %s: %s", expected, result.Proposal.Patch)
		}
	}
}

func TestPlanAssistFormRepairPromptForbidsCanonicalDiscriminatorEcho(t *testing.T) {
	prompt := planAssistFormRepairPrompt(
		planComposerRequest{SourceType: "Geometry", Target: "case", Intent: "basic cylinder flow"},
		agent.Action{}, errors.New("reference_geometry.area.type_name is not requested"), 1,
	)
	for _, expected := range []string{"schema-mechanical", "do not ask the user", "quantity form values contain only value and units", "reference_geometry.area.type_name", "1 of 3"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("form repair prompt is missing %q: %s", expected, prompt)
		}
	}
}

func TestRecommendedPlanAssistPatchExpandsHighConfidenceBoundaryAssignment(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"models":{"type":"entity_assignment","model_choices":[{"value":"existing:0","model_type":"Wall","entity_property":"surfaces","index":0}],"entity_choices":[{"value":"face-1","payload":{"name":"face-1","private_attribute_id":"face-1"}},{"value":"face-2","payload":{"name":"face-2","private_attribute_id":"face-2"}}],"default_model":"existing:0","default_entities":["face-1","face-2"],"recommendation":{"confidence":"high"}}},"required":["models"]}`)
	current := json.RawMessage(`{"models":[{"type":"Wall","name":"Wall","entities":{"stored_entities":[{"name":"*"}]}}],"time_stepping":{"type_name":"Steady","max_steps":2000}}`)
	patch, applied, err := recommendedPlanAssistPatch(schema, current)
	if err != nil {
		t.Fatal(err)
	}
	if !applied {
		t.Fatal("high-confidence Flow360 boundary recommendation was not applied")
	}
	var decoded map[string]any
	if err := json.Unmarshal(patch, &decoded); err != nil {
		t.Fatal(err)
	}
	models := decoded["models"].([]any)
	wall := models[0].(map[string]any)
	entities := wall["surfaces"].(map[string]any)["stored_entities"].([]any)
	if len(entities) != 2 || entities[0].(map[string]any)["name"] != "face-1" {
		t.Fatalf("recommended concrete surfaces were not expanded: %#v", decoded)
	}
	merged, err := mergePlanAssistPatches(
		json.RawMessage(`{"time_stepping":{"type_name":"Steady","max_steps":2000}}`), patch,
	)
	if err != nil || !strings.Contains(string(merged), `"time_stepping"`) || !strings.Contains(string(merged), `"models"`) {
		t.Fatalf("recommendation did not merge with the candidate patch: %s / %v", merged, err)
	}
}

func TestSurfaceRefinementInheritancePatchUsesGlobalFlow360Default(t *testing.T) {
	current := json.RawMessage(`{
		"meshing":{
			"defaults":{"surface_max_edge_length":{"value":0.05,"units":"m"}},
			"refinements":[
				{"name":"Main element","refinement_type":"SurfaceRefinement","entities":{"stored_entities":[{"name":"wing"}]}},
				{"name":"Slat and flap","refinement_type":"SurfaceRefinement","entities":{"stored_entities":[{"name":"slat"}]}},
				{"name":"Keep symmetry spacing","refinement_type":"PassiveSpacing","type":"projected"}
			]
		}
	}`)
	patch, applied, err := surfaceRefinementInheritancePatch([]flow360.PreflightIssue{
		{Level: "error", Code: "value_error", Path: "meshing.refinements.0", Message: "Value error, SurfaceRefinement requires at least one of 'max_edge_length', 'curvature_resolution_angle', or 'resolve_face_boundaries' to be specified."},
		{Level: "error", Code: "value_error", Path: "meshing.refinements.1", Message: "Value error, SurfaceRefinement requires at least one of 'max_edge_length', 'curvature_resolution_angle', or 'resolve_face_boundaries' to be specified."},
	}, current)
	if err != nil || !applied {
		t.Fatalf("global Flow360 surface size was not inherited: applied=%v err=%v", applied, err)
	}
	merged, err := plans.MergeSimulationParams(current, patch)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		`"name":"Main element"`, `"name":"Slat and flap"`,
		`"max_edge_length":{"units":"m","value":0.05}`,
		`"name":"Keep symmetry spacing"`, `"type":"projected"`,
	} {
		if !strings.Contains(string(merged), expected) {
			t.Fatalf("inherited candidate lost %s: patch=%s merged=%s", expected, patch, merged)
		}
	}
}

func TestSurfaceRefinementInheritancePatchRequiresAuthoritativeGlobalDefault(t *testing.T) {
	current := json.RawMessage(`{"meshing":{"refinements":[{"refinement_type":"SurfaceRefinement"}]}}`)
	patch, applied, err := surfaceRefinementInheritancePatch([]flow360.PreflightIssue{{
		Level: "error", Code: "value_error", Path: "meshing.refinements.0",
		Message: "SurfaceRefinement requires at least one of 'max_edge_length', 'curvature_resolution_angle', or 'resolve_face_boundaries' to be specified.",
	}}, current)
	if err != nil || applied || patch != nil {
		t.Fatalf("repair invented a surface size without a Flow360 global default: applied=%v patch=%s err=%v", applied, patch, err)
	}
}

func TestAccumulatePlanAssistRepairPreservesEarlierBoundaryCorrection(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"models":{"type":"array"},"time_stepping":{"type":"object","properties":{"steps":{"type":"integer"}}}}}`)
	current := agent.Proposal{
		Patch:           json.RawMessage(`{"models":[{"type":"SymmetryPlane","surfaces":{"stored_entities":[{"name":"ghost-plane-17","private_attribute_id":"entity-17"}]}}]}`),
		ValidationHints: []string{"Applied high-confidence boundary coverage repair."},
	}
	repaired := agent.Proposal{Patch: json.RawMessage(`{"time_stepping":{"steps":2000}}`)}
	accumulated, err := accumulatePlanAssistRepair(current, repaired, schema)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"name":"ghost-plane-17"`, `"steps":2000`} {
		if !strings.Contains(string(accumulated.Patch), expected) {
			t.Fatalf("accumulated repair lost %s: %s", expected, accumulated.Patch)
		}
	}
	if len(accumulated.ValidationHints) != 1 {
		t.Fatalf("repair evidence was lost: %#v", accumulated.ValidationHints)
	}
}

func TestMissingPlanAssistBaselinePatchRestoresRequiredArrayMembersOnly(t *testing.T) {
	baseline := json.RawMessage(`{
		"meshing":{"refinements":[
			{"name":"Main element","type":"SurfaceRefinement","entities":{"stored_entities":[{"name":"wall"}]},"max_edge_length":0.2},
			{"name":"Wake","type":"SurfaceRefinement","entities":{"stored_entities":[{"name":"wake"}]},"max_edge_length":0.5}
		]},
		"outputs":[
			{"name":"Surface output","entities":{"stored_entities":[{"name":"wall"}]}},
			{"name":"Slice output","entities":{"stored_entities":[{"name":"center"}]}}
		],
		"operating_condition":{"alpha":0,"beta":0}
	}`)
	current := json.RawMessage(`{
		"meshing":{"refinements":[
			{"name":"Main element","type":"SurfaceRefinement","max_edge_length":0.1},
			{"name":"Wake","max_edge_length":0.5}
		]},
		"outputs":[{"name":"Surface output"},{"name":"Slice output"}]
	}`)
	patch, applied, err := missingPlanAssistBaselinePatch([]flow360.PreflightIssue{
		{Level: "error", Code: "missing", Path: "meshing.refinements.0.entities"},
		{Level: "error", Code: "missing", Path: "meshing.refinements.1.type"},
		{Level: "error", Code: "missing", Path: "meshing.refinements.1.entities"},
		{Level: "error", Code: "missing", Path: "outputs.0.entities"},
		{Level: "error", Code: "missing", Path: "outputs.1.entities"},
		{Level: "error", Code: "value_error", Path: "operating_condition.alpha"},
	}, baseline, current)
	if err != nil || !applied {
		t.Fatalf("required Draft values were not recovered: applied=%v err=%v", applied, err)
	}
	merged, err := plans.MergeSimulationParams(current, patch)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		`"entities":{"stored_entities":[{"name":"wall"}]}`,
		`"type":"SurfaceRefinement"`,
		`"name":"center"`,
		`"max_edge_length":0.1`,
	} {
		if !strings.Contains(string(merged), expected) {
			t.Fatalf("recovered candidate is missing %s: %s", expected, merged)
		}
	}
	if strings.Contains(string(merged), `"operating_condition"`) {
		t.Fatalf("unrelated deletion was incorrectly restored: %s", merged)
	}
}

func TestUnsupportedPlanAssistPatchRemovesContextRejectedArrayFields(t *testing.T) {
	current := json.RawMessage(`{"meshing":{"refinements":[{"name":"Main element","refinement_type":"SurfaceRefinement","entities":{"stored_entities":[{"name":"wing"}]},"max_edge_length":{"value":0.04,"units":"m"},"resolve_face_boundaries":true},{"name":"Slat and flap","refinement_type":"SurfaceRefinement","entities":{"stored_entities":[{"name":"slat"}]},"max_edge_length":{"value":0.025,"units":"m"},"resolve_face_boundaries":true}]}}`)
	patch, applied, err := unsupportedPlanAssistPatch([]flow360.PreflightIssue{
		{Level: "error", Code: "value_error", Path: "meshing.refinements.0.resolve_face_boundaries", Message: "Value error, resolve_face_boundaries is only supported when geometry AI is used."},
		{Level: "error", Code: "value_error", Path: "meshing.refinements.1.resolve_face_boundaries", Message: "Value error, resolve_face_boundaries is only supported when geometry AI is used."},
	}, current)
	if err != nil || !applied {
		t.Fatalf("contextual Flow360 rejection was not converted to a removal patch: applied=%v err=%v", applied, err)
	}
	merged, err := plans.MergeSimulationParams(current, patch)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{`"resolve_face_boundaries"`} {
		if strings.Contains(string(merged), forbidden) {
			t.Fatalf("unsupported field survived repair: %s", merged)
		}
	}
	for _, preserved := range []string{`"name":"Main element"`, `"name":"Slat and flap"`, `"max_edge_length":{"units":"m","value":0.04}`, `"entities"`} {
		if !strings.Contains(string(merged), preserved) {
			t.Fatalf("valid refinement content was lost while repairing %s: %s", preserved, merged)
		}
	}
}

func TestPlanAssistCanonicalPatchUsesFlow360ModelDumpRepresentation(t *testing.T) {
	baseline := json.RawMessage(`{"meshing":{"refinements":[{"name":"Main","faces":{"stored_entities":[{"name":"wing"}]},"max_edge_length":0.2}]},"run_control":{"max_steps":1000}}`)
	canonical := json.RawMessage(`{"meshing":{"refinements":[{"name":"Main","entities":{"stored_entities":[{"name":"wing"}]},"max_edge_length":0.1}]},"run_control":{"max_steps":1000}}`)
	patch, err := planAssistCanonicalPatch(baseline, canonical)
	if err != nil {
		t.Fatal(err)
	}
	merged, err := plans.MergeSimulationParams(baseline, patch)
	if err != nil {
		t.Fatal(err)
	}
	var mergedValue any
	var canonicalValue any
	if json.Unmarshal(merged, &mergedValue) != nil || json.Unmarshal(canonical, &canonicalValue) != nil || !reflect.DeepEqual(mergedValue, canonicalValue) {
		t.Fatalf("canonical Flow360 model dump was not reproduced: patch=%s merged=%s", patch, merged)
	}
	if strings.Contains(string(patch), `"run_control"`) {
		t.Fatalf("unchanged canonical fields leaked into the sparse patch: %s", patch)
	}
}

func TestRecommendedPlanAssistPatchExpandsHighConfidenceFieldRemoval(t *testing.T) {
	schema := json.RawMessage(`{
		"type":"object","required":["time_stepping"],"properties":{"time_stepping":{
			"type":"object","required":["max_steps"],"properties":{"max_steps":{
				"type":"field_removal","recommendation":{"confidence":"high","provenance":"flow360_schema_validation"}
			}}
		}}
	}`)
	current := json.RawMessage(`{"time_stepping":{"type_name":"Unsteady","max_steps":2000,"steps":2000}}`)
	patch, applied, err := recommendedPlanAssistPatch(schema, current)
	if err != nil {
		t.Fatal(err)
	}
	if !applied || !strings.Contains(string(patch), `"max_steps":null`) {
		t.Fatalf("high-confidence field removal was not expanded: applied=%v patch=%s", applied, patch)
	}
	compiled, err := plans.Compile(plans.CreateInput{
		ProjectID: "prj", SourceID: "geo", SourceType: "Geometry", Target: "case", Name: "repair", Intent: "repair",
		Baseline: current, Patch: patch,
	})
	if err != nil {
		t.Fatal(err)
	}
	merged, err := plans.MergedSimulationParams(compiled)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if json.Unmarshal(merged, &decoded) != nil {
		t.Fatal("could not decode removal patch")
	}
	timeStepping := decoded["time_stepping"].(map[string]any)
	if _, exists := timeStepping["max_steps"]; exists {
		t.Fatalf("merge-patch removal was not applied: %s", merged)
	}
}

func TestPlanAssistPromptUsesDefaultsWithoutInventingGeometryEvidence(t *testing.T) {
	prompt := planAssistPrompt(planComposerRequest{
		SourceType: "Geometry", Target: "case",
		Intent: "Create the most basic cylinder-flow test. Do I need a wind tunnel?",
		Prompt: "Fill the parameters for me.",
	})
	for _, expected := range []string{
		"parameter assistance, not geometry generation",
		"Never claim CAD dimensions",
		"Read the schema catalog field-by-field",
		"Never invent a nearby field name",
		"Build a coherent setup across all active stages",
		"choose defensible reviewable defaults",
		"Preserve schema-valid infrastructure and entity assignments",
		"never ask the user to perform a schema-mechanical correction",
		"Do not turn every unspecified preference into a blocking question",
		"reviewed conformal VolumeMesh with identical node counts",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("plan assist prompt is missing %q: %s", expected, prompt)
		}
	}
	if !strings.Contains(prompt, "Use the language of the Plan intent and User form instruction") {
		t.Fatalf("plan assist prompt does not preserve the user's language: %s", prompt)
	}
}

func TestPlanAssistPromptUsesDraftUpdateContract(t *testing.T) {
	request := planComposerRequest{
		SourceType: "Geometry", Target: "case", DraftID: "draft-17",
		Intent: "配置参数", Prompt: "配置参数",
	}
	prompt := planAssistPrompt(request)
	for _, expected := range []string{`update-draft`, `draft_id "draft-17"`, `target "draft"`, `does not run it`} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("Draft prompt is missing %q: %s", expected, prompt)
		}
	}
	if strings.Contains(prompt, "Return exactly one create-plan proposal") {
		t.Fatalf("Draft prompt still requests a create-plan action: %s", prompt)
	}
}

func TestCombinedPlanFormSchemaPreservesOverlappingStageObjects(t *testing.T) {
	form := flow360.PlanFormSchema{
		Stages: []string{"SurfaceMesh", "VolumeMesh"},
		Schemas: map[string]json.RawMessage{
			"SurfaceMesh": json.RawMessage(`{"type":"object","properties":{"meshing":{"type":"object","properties":{"surface":{"type":"number"}}}}}`),
			"VolumeMesh":  json.RawMessage(`{"type":"object","properties":{"meshing":{"type":"object","properties":{"volume":{"type":"number"}}}}}`),
		},
	}
	schema, err := combinedPlanFormSchema(form)
	if err != nil {
		t.Fatal(err)
	}
	if err := plans.ValidateFormValues(schema, json.RawMessage(`{"meshing":{"surface":0.1,"volume":1.2}}`)); err != nil {
		t.Fatal(err)
	}
	if err := plans.ValidateFormValues(schema, json.RawMessage(`{"operating_condition":{}}`)); err == nil {
		t.Fatal("expected a field outside the active source-to-target route to be rejected")
	}
}

func TestIncludePlanRecoverySchemaMakesForbiddenFieldRemovalAgentEditable(t *testing.T) {
	form := flow360.PlanFormSchema{
		Stages: []string{"Case"},
		Schemas: map[string]json.RawMessage{"Case": json.RawMessage(`{
			"type":"object","properties":{"time_stepping":{"type":"object","properties":{"steps":{"type":"integer"}}}}
		}`)},
	}
	recovery := json.RawMessage(`{
		"type":"object","required":["time_stepping"],"properties":{"time_stepping":{
			"type":"object","required":["max_steps"],"properties":{"max_steps":{"type":"field_removal"}}
		}}
	}`)
	combined, err := combinedPlanFormSchema(includePlanRecoverySchema(form, recovery))
	if err != nil {
		t.Fatal(err)
	}
	values := json.RawMessage(`{"time_stepping":{"steps":2000,"max_steps":null}}`)
	if err := plans.ValidateFormValues(combined, values); err != nil {
		t.Fatalf("Agent could not express the preflight-requested deletion: %v; schema=%s", err, combined)
	}
}

func TestSchemaPromptCatalogCarriesStageAndFieldPaths(t *testing.T) {
	form := flow360.PlanFormSchema{
		Stages: []string{"Case"},
		Schemas: map[string]json.RawMessage{
			"Case": json.RawMessage(`{"type":"object","properties":{"time_stepping":{"type":"object","properties":{"max_steps":{"type":"integer","title":"Maximum steps"}}},"operating_condition":{"type":"object","properties":{"alpha":{"type":"quantity","title":"Angle of attack","description":"Incoming-flow angle.","required":true,"unit":"degree","unit_options":["degree","radian"],"value_schema":{"type":"number","minimum":-90,"maximum":90}}}}}}`),
		},
	}
	catalog, err := schemaPromptCatalog(form)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Fields []promptSchemaField `json:"fields"`
	}
	if err := json.Unmarshal(catalog, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Fields) != 2 || decoded.Fields[0].Stage != "Case" || decoded.Fields[0].Path != "operating_condition.alpha" {
		t.Fatalf("unexpected catalog: %#v", decoded.Fields)
	}
	alpha := decoded.Fields[0]
	if !alpha.Required || alpha.Description == "" || alpha.Minimum != float64(-90) || alpha.Maximum != float64(90) || len(alpha.UnitOptions) != 2 {
		t.Fatalf("catalog omitted schema constraints needed by the Agent: %#v", alpha)
	}
	if decoded.Fields[1].Path != "time_stepping.max_steps" {
		t.Fatalf("catalog paths are not deterministic: %#v", decoded.Fields)
	}
}

func TestSchemaPromptCatalogExposesUnionWireVariants(t *testing.T) {
	form := flow360.PlanFormSchema{Stages: []string{"Case"}, Schemas: map[string]json.RawMessage{
		"Case": json.RawMessage(`{"type":"object","properties":{"reference_geometry":{"type":"object","properties":{"area":{"type":"union","variants":[{"type":"quantity","unit_options":["m**2"],"value_schema":{"type":"number"}},{"type":"string"}]}}}}}`),
	}}
	catalog, err := schemaPromptCatalog(form)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Fields []promptSchemaField `json:"fields"`
	}
	if err := json.Unmarshal(catalog, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Fields) != 1 || decoded.Fields[0].Path != "reference_geometry.area" || decoded.Fields[0].Type != "union" || len(decoded.Fields[0].Variants) != 2 {
		t.Fatalf("union wire variants were omitted from the Agent catalog: %s", catalog)
	}
}

func TestSchemaPromptCatalogPreservesArrayItemUnionContracts(t *testing.T) {
	form := flow360.PlanFormSchema{Stages: []string{"SurfaceMesh", "Case"}, Schemas: map[string]json.RawMessage{
		"SurfaceMesh": json.RawMessage(`{"type":"object","properties":{"meshing":{"type":"object","properties":{"refinements":{"type":"array","items":{"type":"union","variants":[{"type":"object","title":"Surface refinement","properties":{"type":{"type":"enum","options":["SurfaceRefinement"],"required":true},"entities":{"type":"entity_list","entity_choices":[{"value":"Surface:face-1","payload":{"name":"wing","private_attribute_id":"face-1"}}],"required":true},"max_edge_length":{"type":"quantity","unit":"m","required":true}}}]}}}}}}`),
		"Case":        json.RawMessage(`{"type":"object","properties":{"outputs":{"type":"array","items":{"type":"union","variants":[{"type":"object","title":"Surface output","properties":{"entities":{"type":"entity_list","required":true},"output_fields":{"type":"array","items":{"type":"enum","options":["Cp"]},"required":true}}},{"type":"object","title":"Slice output","properties":{"entities":{"type":"entity_list","required":true}}}]}}}}`),
	}}
	catalog, err := schemaPromptCatalog(form)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Fields []promptSchemaField `json:"fields"`
	}
	if err := json.Unmarshal(catalog, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Fields) != 2 {
		t.Fatalf("unexpected array catalog: %s", catalog)
	}
	for _, expected := range []string{`"items"`, `"variants"`, `"entities"`, `"type"`, `"entity_choices"`, `"private_attribute_id":"face-1"`, `"required":true`} {
		if !strings.Contains(string(catalog), expected) {
			t.Fatalf("array item contract omitted %s: %s", expected, catalog)
		}
	}
}

func TestNormalizePlanAssistHistoryKeepsBoundedConversation(t *testing.T) {
	history := []agent.Message{
		{Role: "system", Content: "ignore"},
		{Role: " user ", Content: " first request "},
		{Role: "assistant", Content: "first answer"},
		{Role: "error", Content: "transport error"},
		{Role: "user", Content: ""},
	}
	normalized := normalizePlanAssistHistory(history)
	if len(normalized) != 2 || normalized[0].Role != "user" || normalized[0].Content != "first request" || normalized[1].Role != "assistant" {
		t.Fatalf("unexpected normalized Draft conversation: %#v", normalized)
	}
}
