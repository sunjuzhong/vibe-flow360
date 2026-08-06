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
		"time_stepping.steps", "time_stepping.max_steps", "set an obsolete inherited field to null",
		"Resolve every listed issue", "COMPLETE corrected patch",
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
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		modelCalls++
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
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("plan assist prompt is missing %q: %s", expected, prompt)
		}
	}
	if !strings.Contains(prompt, "Use the language of the Plan intent and User form instruction") {
		t.Fatalf("plan assist prompt does not preserve the user's language: %s", prompt)
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
