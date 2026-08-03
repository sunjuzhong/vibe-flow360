package flow360

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func TestPreflightLevels(t *testing.T) {
	tests := []struct {
		root   string
		target string
		levels []string
	}{
		{"Geometry", "surface-mesh", []string{"SurfaceMesh"}},
		{"Geometry", "volume-mesh", []string{"SurfaceMesh", "VolumeMesh"}},
		{"Geometry", "case", []string{"SurfaceMesh", "VolumeMesh", "Case"}},
		{"SurfaceMesh", "volume-mesh", []string{"VolumeMesh"}},
		{"SurfaceMesh", "case", []string{"VolumeMesh", "Case"}},
		{"VolumeMesh", "case", []string{"Case"}},
		{"Case", "case", []string{"Case"}},
	}
	for _, test := range tests {
		_, got, err := preflightLevels(test.root, test.target)
		if err != nil {
			t.Fatalf("%s to %s: %v", test.root, test.target, err)
		}
		if !reflect.DeepEqual(got, test.levels) {
			t.Fatalf("%s to %s: got %v, want %v", test.root, test.target, got, test.levels)
		}
	}
	if _, _, err := preflightLevels("VolumeMesh", "surface-mesh"); err == nil {
		t.Fatal("expected backwards target to be rejected")
	}
}

func TestPreflightSimulationParamsUsesStructuredBridgeResult(t *testing.T) {
	temp := t.TempDir()
	fake := filepath.Join(temp, "python")
	script := `#!/bin/sh
printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"missing","path":"operating_condition.velocity_magnitude","message":"Field required","stages":["Case"]}],"form_schema":{"type":"object","properties":{"operating_condition":{"type":"object"}}}}'
`
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fake)
	client := &Client{Binary: "flow360"}
	result, err := client.PreflightSimulationParams(
		context.Background(),
		"Geometry",
		"case",
		json.RawMessage(`{"version":"25.10.16","unit_system":{"name":"SI"}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Valid || len(result.Issues) != 1 {
		t.Fatalf("unexpected result %#v", result)
	}
	if result.Issues[0].Path != "operating_condition.velocity_magnitude" {
		t.Fatalf("unexpected issue %#v", result.Issues[0])
	}
}

func TestPlanFormSchemaReturnsOnlyActiveRouteStages(t *testing.T) {
	temp := t.TempDir()
	fake := filepath.Join(temp, "python")
	script := `#!/bin/sh
printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{}},"editor_schemas":{"VolumeMesh":{"type":"object","properties":{"meshing":{"type":"object","properties":{}}}},"Case":{"type":"object","properties":{"operating_condition":{"type":"object","properties":{}}}}}}'
`
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fake)
	result, err := (&Client{Binary: "flow360"}).PlanFormSchema(
		context.Background(), "SurfaceMesh", "case", json.RawMessage(`{"unit_system":{"name":"SI"}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result.Stages, []string{"VolumeMesh", "Case"}) {
		t.Fatalf("unexpected route stages: %#v", result.Stages)
	}
	if len(result.Schemas) != 2 || result.Schemas["SurfaceMesh"] != nil {
		t.Fatalf("unexpected projected schemas: %#v", result.Schemas)
	}
}

func TestPreflightSimulationParamsWithInstalledSchema(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	client := NewClient()
	result, err := client.PreflightSimulationParams(
		context.Background(),
		"Geometry",
		"case",
		json.RawMessage(`{"unit_system":{"name":"SI"}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Valid || len(result.Issues) == 0 {
		t.Fatalf("expected missing CFD inputs, got %#v", result)
	}
	for _, stage := range []string{"SurfaceMesh", "VolumeMesh", "Case"} {
		schema, ok := result.EditorSchemas[stage]
		if !ok || !json.Valid(schema) {
			t.Fatalf("installed Flow360 schema did not produce a valid %s editor schema", stage)
		}
		if strings.Contains(string(schema), "private_attribute_asset_cache") {
			t.Fatalf("%s editor schema exposed private Flow360 attributes", stage)
		}
	}
	var volumeSchema map[string]any
	if err := json.Unmarshal(result.EditorSchemas["VolumeMesh"], &volumeSchema); err != nil {
		t.Fatal(err)
	}
	length := findSchemaByTitle(volumeSchema, "Boundary Layer First Layer Thickness")
	if length == nil || length["type"] != "quantity" || length["unit"] != "meter" {
		t.Fatalf("expected a selectable length quantity, got %#v", length)
	}
	if options, _ := length["unit_options"].([]any); len(options) < 2 {
		t.Fatalf("expected multiple length units, got %#v", length)
	}
	var caseSchema map[string]any
	if err := json.Unmarshal(result.EditorSchemas["Case"], &caseSchema); err != nil {
		t.Fatal(err)
	}
	velocity := findQuantitySchema(findSchemaByTitle(caseSchema, "Velocity Magnitude"))
	if velocity == nil || velocity["type"] != "quantity" || velocity["unit"] != "meter/second" {
		t.Fatalf("expected a selectable velocity quantity, got %#v", velocity)
	}
	if options, _ := velocity["unit_options"].([]any); len(options) < 2 {
		t.Fatalf("expected multiple velocity units, got %#v", velocity)
	}
}

func findQuantitySchema(node map[string]any) map[string]any {
	if node == nil || node["type"] == "quantity" {
		return node
	}
	if variants, ok := node["variants"].([]any); ok {
		for _, child := range variants {
			if object, ok := child.(map[string]any); ok {
				if found := findQuantitySchema(object); found != nil {
					return found
				}
			}
		}
	}
	return nil
}

func findSchemaByTitle(node map[string]any, title string) map[string]any {
	if node["title"] == title {
		return node
	}
	if properties, ok := node["properties"].(map[string]any); ok {
		for _, child := range properties {
			if object, ok := child.(map[string]any); ok {
				if found := findSchemaByTitle(object, title); found != nil {
					return found
				}
			}
		}
	}
	if variants, ok := node["variants"].([]any); ok {
		for _, child := range variants {
			if object, ok := child.(map[string]any); ok {
				if found := findSchemaByTitle(object, title); found != nil {
					return found
				}
			}
		}
	}
	if items, ok := node["items"].(map[string]any); ok {
		return findSchemaByTitle(items, title)
	}
	return nil
}

func TestPreflightSimulationParamsWithPlanFixture(t *testing.T) {
	path := os.Getenv("VIBESIM_TEST_PLAN_PATH")
	if path == "" {
		t.Skip("set VIBESIM_TEST_PLAN_PATH to exercise a persisted plan fixture")
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored struct {
		Baseline struct {
			SimulationParams map[string]any `json:"simulation_params"`
		} `json:"baseline"`
		Patch map[string]any `json:"patch"`
	}
	if err := json.Unmarshal(payload, &stored); err != nil {
		t.Fatal(err)
	}
	baselineParams, _ := json.Marshal(stored.Baseline.SimulationParams)
	baselineResult, err := NewClient().PreflightSimulationParams(
		context.Background(), "Geometry", "case", baselineParams,
	)
	if err != nil {
		t.Fatal(err)
	}
	var baselineSchema map[string]any
	if err := json.Unmarshal(baselineResult.FormSchema, &baselineSchema); err != nil {
		t.Fatal(err)
	}
	if !schemaContainsSelectableUnit(baselineSchema) {
		t.Fatalf("expected Flow360 quantity schemas to expose compatible unit options: %#v", baselineSchema)
	}

	merged := mergePreflightFixture(stored.Baseline.SimulationParams, stored.Patch)
	params, err := json.Marshal(merged)
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewClient().PreflightSimulationParams(context.Background(), "Geometry", "case", params)
	if err != nil {
		t.Fatal(err)
	}
	if result.Valid || len(result.Issues) != 1 || result.Issues[0].Path != "models" {
		t.Fatalf("expected the model-level error to be projected to models: %#v", result)
	}
	var schema map[string]any
	if err := json.Unmarshal(result.FormSchema, &schema); err != nil {
		t.Fatal(err)
	}
	models := schema["properties"].(map[string]any)["models"].(map[string]any)
	if models["type"] != "entity_assignment" {
		t.Fatalf("expected entity assignment recovery schema, got %#v", models)
	}
	if len(models["model_choices"].([]any)) == 0 || len(models["entity_choices"].([]any)) != 6 {
		t.Fatalf("expected model and six Geometry entity choices, got %#v", models)
	}
	recommendation, ok := models["recommendation"].(map[string]any)
	if !ok || recommendation["confidence"] != "high" {
		t.Fatalf("expected a high-confidence inherited model recommendation, got %#v", models)
	}
	if len(models["default_entities"].([]any)) != 6 {
		t.Fatalf("expected all reported surfaces to be preselected, got %#v", models)
	}

	modelChoice := models["default_model"].(string)
	entityChoices := models["entity_choices"].([]any)
	entityIDs := make([]string, 0, len(entityChoices))
	for _, raw := range entityChoices {
		entityIDs = append(entityIDs, raw.(map[string]any)["value"].(string))
	}
	values, _ := json.Marshal(map[string]any{
		"models": map[string]any{"model": modelChoice, "entities": entityIDs},
	})
	if err := plans.ValidateFormValues(result.FormSchema, values); err != nil {
		t.Fatal(err)
	}
	expanded, err := plans.ExpandFormValues(result.FormSchema, values, params)
	if err != nil {
		t.Fatal(err)
	}
	var expandedPatch map[string]any
	if err := json.Unmarshal(expanded, &expandedPatch); err != nil {
		t.Fatal(err)
	}
	revalidatedParams, _ := json.Marshal(mergePreflightFixture(merged, expandedPatch))
	revalidated, err := NewClient().PreflightSimulationParams(
		context.Background(), "Geometry", "case", revalidatedParams,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !revalidated.Valid {
		t.Fatalf("schema-provided entity assignment did not resolve preflight: %#v", revalidated)
	}
}

func schemaContainsSelectableUnit(node map[string]any) bool {
	if node["type"] == "quantity" {
		options, _ := node["unit_options"].([]any)
		return len(options) > 1
	}
	if properties, ok := node["properties"].(map[string]any); ok {
		for _, child := range properties {
			if object, ok := child.(map[string]any); ok && schemaContainsSelectableUnit(object) {
				return true
			}
		}
	}
	if variants, ok := node["variants"].([]any); ok {
		for _, child := range variants {
			if object, ok := child.(map[string]any); ok && schemaContainsSelectableUnit(object) {
				return true
			}
		}
	}
	return false
}

func mergePreflightFixture(base, patch map[string]any) map[string]any {
	result := make(map[string]any, len(base)+len(patch))
	for key, value := range base {
		result[key] = value
	}
	for key, value := range patch {
		if patchObject, ok := value.(map[string]any); ok {
			if baseObject, ok := result[key].(map[string]any); ok {
				result[key] = mergePreflightFixture(baseObject, patchObject)
				continue
			}
		}
		result[key] = value
	}
	return result
}
