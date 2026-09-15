package server

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"os"
	"reflect"
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

func TestCompilePlanAssistOperationsCreatesRegisteredSliceOutputIdempotently(t *testing.T) {
	schema := json.RawMessage(`{
  "type":"object",
  "properties":{
    "outputs":{
      "type":"array",
      "items":{
        "type":"union",
        "variants":[{
          "type":"object",
          "title":"SliceOutput",
          "required":["output_type","name","entities","output_fields"],
          "properties":{
            "output_type":{"type":"enum","options":["SliceOutput"]},
            "name":{"type":"string"},
            "entities":{"type":"entity_list","entity_choices":[]},
            "output_fields":{"type":"multi_select","value_key":"items","options":["velocity_m_per_s","pressure_pa"]}
          }
        }]
      }
    }
  }
}`)
	baseline := json.RawMessage(`{
  "unit_system":{"name":"SI"},
  "outputs":[{"output_type":"SurfaceOutput","name":"existing-output","type_name":"SurfaceOutput"}],
  "private_attribute_asset_cache":{"project_entity_info":{
    "face_group_tag":"faceId",
    "draft_entities":[{"name":"existing-sphere","private_attribute_entity_type_name":"Sphere","private_attribute_id":"sphere-1"}]
  }}
}`)
	operation := agent.ParameterOperation{
		Op: "create-slice-output", Origin: []float64{0, 0, 0}, Normal: []float64{0, 0, 1},
		Name: "z=0 velocity", OutputFields: []string{"velocity_m_per_s"},
	}

	patch, err := compilePlanAssistOperations(schema, baseline, []agent.ParameterOperation{operation})
	if err != nil {
		t.Fatal(err)
	}
	identicalPatch, err := compilePlanAssistOperations(schema, baseline, []agent.ParameterOperation{operation})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(patch, identicalPatch) {
		t.Fatalf("identical inputs produced different canonical patches:\nfirst:  %s\nsecond: %s", patch, identicalPatch)
	}
	merged, err := plans.MergeSimulationParams(baseline, patch)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(merged, &document); err != nil {
		t.Fatal(err)
	}
	outputs := document["outputs"].([]any)
	if len(outputs) != 2 || outputs[0].(map[string]any)["name"] != "existing-output" {
		t.Fatalf("existing output was not preserved: %#v", outputs)
	}
	info := document["private_attribute_asset_cache"].(map[string]any)["project_entity_info"].(map[string]any)
	if info["face_group_tag"] != "faceId" {
		t.Fatalf("existing entity metadata was not preserved: %#v", info)
	}
	registry := info["draft_entities"].([]any)
	if len(registry) != 2 || registry[0].(map[string]any)["private_attribute_id"] != "sphere-1" {
		t.Fatalf("existing Draft entities were not preserved: %#v", registry)
	}
	slice := registry[1].(map[string]any)
	if slice["private_attribute_entity_type_name"] != "Slice" {
		t.Fatalf("Slice was not registered: %#v", slice)
	}
	origin := slice["origin"].(map[string]any)
	if origin["units"] != "m" || !reflect.DeepEqual(origin["value"], []any{float64(0), float64(0), float64(0)}) {
		t.Fatalf("Slice origin did not retain Project length units: %#v", origin)
	}
	output := outputs[1].(map[string]any)
	if strings.TrimSpace(output["private_attribute_id"].(string)) == "" {
		t.Fatalf("SliceOutput deterministic private ID was not persisted: %#v", output)
	}
	outputSlice := output["entities"].(map[string]any)["stored_entities"].([]any)[0].(map[string]any)
	if !reflect.DeepEqual(slice, outputSlice) {
		t.Fatalf("registry and SliceOutput do not share the exact Slice payload: registry=%#v output=%#v", slice, outputSlice)
	}
	fields := output["output_fields"].(map[string]any)["items"].([]any)
	if !reflect.DeepEqual(fields, []any{"velocity_m_per_s"}) {
		t.Fatalf("velocity field was not requested: %#v", fields)
	}
	if err := flow360.ValidateDraftEntityReferences(merged); err != nil {
		t.Fatalf("compiled SliceOutput has dangling entity references: %v", err)
	}

	retryOperation := operation
	retryOperation.Normal = []float64{0, 0, 2}
	retryPatch, err := compilePlanAssistOperations(schema, merged, []agent.ParameterOperation{retryOperation})
	if err != nil {
		t.Fatal(err)
	}
	retried, err := plans.MergeSimulationParams(merged, retryPatch)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(jsonDocument(t, merged), jsonDocument(t, retried)) {
		t.Fatalf("retry duplicated or changed the semantic Slice output: patch=%s retried=%s", retryPatch, retried)
	}
}

func TestPlanAssistNormalNormalizationIsOverflowSafe(t *testing.T) {
	normal, err := normalizedPlanAssistVector([]float64{math.MaxFloat64, math.MaxFloat64, math.MaxFloat64})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range normal {
		component := raw.(float64)
		if math.IsNaN(component) || math.IsInf(component, 0) {
			t.Fatalf("huge finite normal produced a non-finite component: %#v", normal)
		}
	}
	if _, err := normalizedPlanAssistVector([]float64{0, 0, 0}); err == nil {
		t.Fatal("zero normal was accepted")
	}
}

func TestPlanAssistProjectLengthUnitPrefersUnitSystem(t *testing.T) {
	baseline := map[string]any{
		"unit_system": map[string]any{"name": "SI"},
		"private_attribute_asset_cache": map[string]any{"project_entity_info": map[string]any{
			"draft_entities": []any{map[string]any{
				"private_attribute_entity_type_name": "Slice",
				"origin":                             map[string]any{"units": "cm", "value": []any{float64(0), float64(0), float64(1)}},
			}},
		}},
	}
	unit, err := planAssistProjectLengthUnit(nil, baseline)
	if err != nil || unit != "m" {
		t.Fatalf("SI unit_system must override existing quantity units: unit=%q err=%v", unit, err)
	}
	delete(baseline, "unit_system")
	unit, err = planAssistProjectLengthUnit(nil, baseline)
	if err != nil || unit != "cm" {
		t.Fatalf("existing quantity must be the fallback without unit_system: unit=%q err=%v", unit, err)
	}
}

func TestCompileSliceOutputRejectsIDOnlyIdempotencyMatch(t *testing.T) {
	registered := map[string]any{
		"name": "registered", "normal": []any{float64(0), float64(0), float64(1)},
		"origin":                             map[string]any{"units": "m", "value": []any{float64(0), float64(0), float64(0)}},
		"private_attribute_entity_type_name": "Slice", "private_attribute_id": "slice-existing",
	}
	mismatched := clonePlanAssistValue(registered).(map[string]any)
	mismatched["normal"] = []any{float64(0), float64(1), float64(0)}
	baseline, err := json.Marshal(map[string]any{
		"unit_system": map[string]any{"name": "SI"},
		"outputs": []any{map[string]any{
			"output_type": "SliceOutput", "name": "stale", "private_attribute_id": "output-existing",
			"entities":      map[string]any{"stored_entities": []any{mismatched}},
			"output_fields": map[string]any{"items": []any{"velocity_m_per_s"}},
		}},
		"private_attribute_asset_cache": map[string]any{"project_entity_info": map[string]any{
			"draft_entities": []any{registered},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	operation := agent.ParameterOperation{
		Op: "create-slice-output", Origin: []float64{0, 0, 0}, Normal: []float64{0, 0, 1},
		Name: "correct", OutputFields: []string{"velocity_m_per_s"},
	}
	patch, err := compilePlanAssistOperations(sliceOutputSchemaForTest(), baseline, []agent.ParameterOperation{operation})
	if err != nil {
		t.Fatal(err)
	}
	merged, err := plans.MergeSimulationParams(baseline, patch)
	if err != nil {
		t.Fatal(err)
	}
	document := jsonDocument(t, merged)
	outputs := document["outputs"].([]any)
	if len(outputs) != 2 {
		t.Fatalf("ID-only match incorrectly suppressed the corrected SliceOutput: %#v", outputs)
	}
	correctedSlice := outputs[1].(map[string]any)["entities"].(map[string]any)["stored_entities"].([]any)[0]
	registrySlice := document["private_attribute_asset_cache"].(map[string]any)["project_entity_info"].(map[string]any)["draft_entities"].([]any)[0]
	if !reflect.DeepEqual(correctedSlice, registrySlice) {
		t.Fatalf("corrected output does not carry the registered Slice payload: output=%#v registry=%#v", correctedSlice, registrySlice)
	}
}

func sliceOutputSchemaForTest() json.RawMessage {
	return json.RawMessage(`{
  "type":"object","properties":{"outputs":{"type":"array","items":{"type":"union","variants":[{
    "type":"object","title":"SliceOutput","required":["output_type","name","entities","output_fields"],
    "properties":{
      "output_type":{"type":"enum","options":["SliceOutput"]},
      "name":{"type":"string"},
      "entities":{"type":"entity_list","entity_choices":[]},
      "output_fields":{"type":"multi_select","value_key":"items","options":["velocity_m_per_s","pressure_pa"]}
    }
  }]}}}
}`)
}

func jsonDocument(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	return document
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

func TestInstalledFlow360CanonicalizesTypedSliceOutput(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	fixture, err := os.ReadFile("../../tutorials/T12-liquid-gravity/simulation.json")
	if err != nil {
		t.Fatal(err)
	}
	baselineDocument := jsonDocument(t, fixture)
	outputs := make([]any, 0)
	for _, raw := range planAssistArray(baselineDocument["outputs"]) {
		output, _ := raw.(map[string]any)
		if output["output_type"] != "SliceOutput" {
			outputs = append(outputs, output)
		}
	}
	baselineDocument["outputs"] = outputs
	info := baselineDocument["private_attribute_asset_cache"].(map[string]any)["project_entity_info"].(map[string]any)
	draftEntities := make([]any, 0)
	for _, raw := range planAssistArray(info["draft_entities"]) {
		entity, _ := raw.(map[string]any)
		if entity["private_attribute_entity_type_name"] != "Slice" {
			draftEntities = append(draftEntities, entity)
		}
	}
	info["draft_entities"] = draftEntities
	baseline, err := json.Marshal(baselineDocument)
	if err != nil {
		t.Fatal(err)
	}

	client := flow360.NewClient()
	form, err := client.PlanFormSchema(context.Background(), "Geometry", "case", baseline)
	if err != nil {
		t.Fatal(err)
	}
	schema, err := combinedPlanFormSchema(form)
	if err != nil {
		t.Fatal(err)
	}
	operation := agent.ParameterOperation{
		Op: "create-slice-output", Origin: []float64{0, 0, 0}, Normal: []float64{0, 0, 1},
		Name: "z=0 velocity", OutputFields: []string{"velocity_m_per_s"},
	}
	patch, err := compilePlanAssistOperations(schema, baseline, []agent.ParameterOperation{operation})
	if err != nil {
		t.Fatal(err)
	}
	merged, err := plans.MergeSimulationParams(baseline, patch)
	if err != nil {
		t.Fatal(err)
	}
	if err := flow360.ValidateDraftEntityReferences(merged); err != nil {
		t.Fatalf("compiled typed Slice output has dangling references: %v", err)
	}
	compiled := jsonDocument(t, merged)
	compiledOutput := findSliceOutput(t, compiled)
	compiledOutputID, _ := compiledOutput["private_attribute_id"].(string)
	if strings.TrimSpace(compiledOutputID) == "" {
		t.Fatalf("compiled SliceOutput has no persisted deterministic ID: %#v", compiledOutput)
	}

	result, err := client.PreflightSimulationParams(context.Background(), "Geometry", "case", merged)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Valid {
		t.Fatalf("typed SliceOutput failed installed Flow360 preflight: %#v", result.Issues)
	}
	canonical := jsonDocument(t, result.CanonicalParams)
	canonicalOutput := findSliceOutput(t, canonical)
	if canonicalOutput["private_attribute_id"] != compiledOutputID {
		t.Fatalf("installed Flow360 canonicalization changed deterministic SliceOutput ID: compiled=%q canonical=%#v", compiledOutputID, canonicalOutput["private_attribute_id"])
	}
	canonicalInfo := canonical["private_attribute_asset_cache"].(map[string]any)["project_entity_info"].(map[string]any)
	canonicalEntities := planAssistArray(canonicalInfo["draft_entities"])
	if len(canonicalEntities) != 1 {
		t.Fatalf("installed Flow360 canonicalization did not retain one registered Slice: %#v", canonicalEntities)
	}
	storedSlice := canonicalOutput["entities"].(map[string]any)["stored_entities"].([]any)[0]
	if !reflect.DeepEqual(storedSlice, canonicalEntities[0]) {
		t.Fatalf("canonical SliceOutput and registry do not share the same Slice payload: output=%#v registry=%#v", storedSlice, canonicalEntities[0])
	}
	fields := canonicalOutput["output_fields"].(map[string]any)["items"].([]any)
	if !reflect.DeepEqual(fields, []any{"velocity_m_per_s"}) {
		t.Fatalf("installed Flow360 canonicalization lost velocity_m_per_s: %#v", fields)
	}
}

func findSliceOutput(t *testing.T, document map[string]any) map[string]any {
	t.Helper()
	for _, raw := range planAssistArray(document["outputs"]) {
		output, _ := raw.(map[string]any)
		if output["output_type"] == "SliceOutput" {
			return output
		}
	}
	t.Fatal("SliceOutput not found")
	return nil
}
