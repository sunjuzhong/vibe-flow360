package server

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func TestPlanAssistPromptUsesDefaultsWithoutInventingGeometryEvidence(t *testing.T) {
	prompt := planAssistPrompt(planComposerRequest{
		SourceType: "Geometry", Target: "case",
		Intent: "Create the most basic cylinder-flow test. Do I need a wind tunnel?",
		Prompt: "Fill the parameters for me.",
	})
	for _, expected := range []string{
		"parameter assistance, not geometry generation",
		"Never claim CAD dimensions",
		"choose defensible reviewable defaults",
		"do not ask for a physical wind tunnel",
		"Do not turn every unspecified preference into a blocking question",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("plan assist prompt is missing %q: %s", expected, prompt)
		}
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
			"Case": json.RawMessage(`{"type":"object","properties":{"operating_condition":{"type":"object","properties":{"alpha":{"type":"quantity","title":"Angle of attack","unit":"degree"}}}}}`),
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
	if len(decoded.Fields) != 1 || decoded.Fields[0].Stage != "Case" || decoded.Fields[0].Path != "operating_condition.alpha" {
		t.Fatalf("unexpected catalog: %#v", decoded.Fields)
	}
}
