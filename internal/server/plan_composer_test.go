package server

import (
	"encoding/json"
	"errors"
	"net/http"
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
		"do not ask for a physical wind tunnel",
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
