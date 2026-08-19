package server

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func TestCompilePlanAssistOperationsPreservesCanonicalArrayObjects(t *testing.T) {
	schema := json.RawMessage(`{
  "type":"object","properties":{"models":{"type":"array","items":{"type":"object","properties":{
    "type":{"type":"string"},
    "initial_condition":{"type":"object","properties":{"rho":{"type":"number"}}},
    "turbulence_model_solver":{"type":"object","properties":{"absolute_tolerance":{"type":"number"}}}
  }}}}
}`)
	baseline := json.RawMessage(`{"models":[{"type":"Fluid","initial_condition":{"type_name":"NavierStokesInitialCondition","rho":1.0},"turbulence_model_solver":{"type_name":"SpalartAllmaras","absolute_tolerance":1e-7}},{"type":"Wall","name":"wing","entities":{"stored_entities":[{"name":"wing","private_attribute_id":"face-1"}]}}]}`)
	patch, err := compilePlanAssistOperations(schema, baseline, []agent.ParameterOperation{{
		Op: "set", Path: "/models/0/turbulence_model_solver/absolute_tolerance", Value: 1e-8,
	}})
	if err != nil {
		t.Fatal(err)
	}
	merged, err := plans.MergeSimulationParams(baseline, patch)
	if err != nil {
		t.Fatal(err)
	}
	for _, preserved := range []string{
		`"type_name":"NavierStokesInitialCondition"`,
		`"type_name":"SpalartAllmaras"`,
		`"absolute_tolerance":1e-8`,
		`"type":"Wall"`,
		`"private_attribute_id":"face-1"`,
	} {
		if !strings.Contains(string(merged), preserved) {
			t.Fatalf("compiled operation lost %s: patch=%s merged=%s", preserved, patch, merged)
		}
	}
}

func TestCompilePlanAssistOperationsRejectsComplexArrayReplacement(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"models":{"type":"array","items":{"type":"object","properties":{"type":{"type":"string"}}}}}}`)
	baseline := json.RawMessage(`{"models":[{"type":"Fluid","type_name":"FluidModel"}]}`)
	_, err := compilePlanAssistOperations(schema, baseline, []agent.ParameterOperation{{
		Op: "set", Path: "/models", Value: []any{map[string]any{"type": "Wall"}},
	}})
	if err == nil || !strings.Contains(err.Error(), "complex object array") {
		t.Fatalf("complex array replacement was not rejected: %v", err)
	}
}

func TestCompilePlanAssistOperationsAppendsOneValidatedItem(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"outputs":{"type":"array","items":{"type":"object","required":["output_type","name"],"properties":{"output_type":{"type":"string"},"name":{"type":"string"}}}}}}`)
	baseline := json.RawMessage(`{"outputs":[{"output_type":"SurfaceOutput","name":"forces","type_name":"SurfaceOutput"}]}`)
	patch, err := compilePlanAssistOperations(schema, baseline, []agent.ParameterOperation{{
		Op: "append", Path: "/outputs", Value: map[string]any{"output_type": "SliceOutput", "name": "midplane"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	merged, err := plans.MergeSimulationParams(baseline, patch)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"type_name":"SurfaceOutput"`, `"output_type":"SliceOutput"`, `"name":"midplane"`} {
		if !strings.Contains(string(merged), expected) {
			t.Fatalf("append did not preserve and add array items: %s", merged)
		}
	}
}

func TestInstalledFlow360ValidatesOperationCompiledTutorial(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	baseline, err := os.ReadFile("../../tutorials/T04-airfoil-edge-refinement/simulation.json")
	if err != nil {
		t.Fatal(err)
	}
	client := flow360.NewClient()
	form, err := client.PlanFormSchema(context.Background(), "Geometry", "volume-mesh", baseline)
	if err != nil {
		t.Fatal(err)
	}
	schema, err := combinedPlanFormSchema(form)
	if err != nil {
		t.Fatal(err)
	}
	patch, err := compilePlanAssistOperations(schema, baseline, []agent.ParameterOperation{{
		Op: "set", Path: "/meshing/refinements/0/max_edge_length", Value: map[string]any{"value": 0.035, "units": "m"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	merged, err := plans.MergeSimulationParams(baseline, patch)
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.PreflightSimulationParams(context.Background(), "Geometry", "volume-mesh", merged)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Valid {
		t.Fatalf("operation-compiled tutorial failed installed Flow360 validation: %#v", result.Issues)
	}
	for _, preserved := range []string{`"type_name":"NavierStokesInitialCondition"`, `"type_name":"SpalartAllmaras"`, `"value":0.035`} {
		if !strings.Contains(string(result.CanonicalParams), preserved) {
			t.Fatalf("installed Flow360 canonical output lost %s", preserved)
		}
	}
}
