package flow360

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
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

func TestPreflightSimulationParamsUpgradesStructuredVersionMismatchAndRetries(t *testing.T) {
	temp := t.TempDir()
	fake := filepath.Join(temp, "python")
	attempt := filepath.Join(temp, "attempt")
	script := `#!/bin/sh
if [ ! -f "` + attempt + `" ]; then
  printf '1' > "` + attempt + `"
  printf '%s' '{"schema_version":1,"validator_version":"25.10.17","valid":false,"issues":[{"level":"error","code":"schema_input","message":"The cloud ` + "`SimulationParam`" + ` (version: 25.10.18) is too new for your local schema package (version: 25.10.17). Errors may occur since forward compatibility is limited."},{"level":"error","code":"schema_input","message":"method"}],"form_schema":{"type":"object","properties":{}},"editor_schemas":{}}'
  exit 0
fi
printf '%s' '{"schema_version":1,"validator_version":"25.10.18","valid":true,"issues":[],"form_schema":{"type":"object","properties":{}},"editor_schemas":{}}'
`
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fake)
	upgradeCalls := 0
	client := &Client{Binary: "flow360", UpgradeCompatible: func(_ context.Context, target, constraint string) error {
		upgradeCalls++
		if target != "25.10.18" || constraint != "25.10.*" {
			t.Fatalf("unexpected upgrade target %q constraint %q", target, constraint)
		}
		return nil
	}}
	result, err := client.PreflightSimulationParams(
		context.Background(), "Geometry", "case", json.RawMessage(`{"unit_system":{"name":"SI"}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Valid || result.ValidatorVersion != "25.10.18" || upgradeCalls != 1 {
		t.Fatalf("result = %#v, upgrade calls = %d", result, upgradeCalls)
	}
}

func TestPreflightSimulationParamsRejectsStructuredCrossReleaseMismatch(t *testing.T) {
	temp := t.TempDir()
	fake := filepath.Join(temp, "python")
	script := `#!/bin/sh
printf '%s' '{"schema_version":1,"validator_version":"25.10.18","valid":false,"issues":[{"level":"error","code":"schema_input","message":"The cloud SimulationParam (version: 25.11.2) is too new for your local schema package (version: 25.10.18)."}],"form_schema":{"type":"object","properties":{}},"editor_schemas":{}}'
`
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fake)
	client := &Client{Binary: "flow360", UpgradeCompatible: func(context.Context, string, string) error {
		t.Fatal("cross-release mismatch must not run the updater")
		return nil
	}}
	_, err := client.PreflightSimulationParams(
		context.Background(), "Geometry", "case", json.RawMessage(`{"unit_system":{"name":"SI"}}`),
	)
	if CompatibilityErrorCode(err) != "flow360_release_not_supported" {
		t.Fatalf("unexpected error: %v", err)
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
	var surfaceSchema map[string]any
	if err := json.Unmarshal(result.EditorSchemas["SurfaceMesh"], &surfaceSchema); err != nil {
		t.Fatal(err)
	}
	if targetCount := findSchemaByTitle(surfaceSchema, "Target Surface Node Count"); targetCount != nil {
		t.Fatalf("legacy mesher form exposed unsupported target node count: %#v", targetCount)
	}
	var volumeSchema map[string]any
	if err := json.Unmarshal(result.EditorSchemas["VolumeMesh"], &volumeSchema); err != nil {
		t.Fatal(err)
	}
	length := findSchemaByTitle(volumeSchema, "Boundary Layer First Layer Thickness")
	if length == nil || length["type"] != "quantity" || length["unit"] != "m" {
		t.Fatalf("expected a selectable length quantity, got %#v", length)
	}
	if options, _ := length["unit_options"].([]any); len(options) < 2 || options[0] != "m" || slices.Contains(options, any("meter")) {
		t.Fatalf("expected multiple length units, got %#v", length)
	}
	if aliases, _ := length["unit_aliases"].(map[string]any); aliases["meter"] != "m" {
		t.Fatalf("expected legacy length alias normalization, got %#v", length)
	}
	var caseSchema map[string]any
	if err := json.Unmarshal(result.EditorSchemas["Case"], &caseSchema); err != nil {
		t.Fatal(err)
	}
	velocity := findQuantitySchema(findSchemaByTitle(caseSchema, "Velocity Magnitude"))
	if velocity == nil || velocity["type"] != "quantity" || velocity["unit"] != "m/s" {
		t.Fatalf("expected a selectable velocity quantity, got %#v", velocity)
	}
	if options, _ := velocity["unit_options"].([]any); len(options) < 2 || options[0] != "m/s" || slices.Contains(options, any("meter/second")) {
		t.Fatalf("expected multiple velocity units, got %#v", velocity)
	}
	if aliases, _ := velocity["unit_aliases"].(map[string]any); aliases["meter/second"] != "m/s" {
		t.Fatalf("expected legacy velocity alias normalization, got %#v", velocity)
	}
	velocityField := findSchemaByTitle(caseSchema, "Velocity Magnitude")
	expression := findSchemaByType(velocityField, "expression")
	if expression == nil || expression["expected_unit"] != "m/s" || expression["allow_runtime"] != false {
		t.Fatalf("expected a typed compile-time velocity Expression, got expression=%#v field=%#v", expression, velocityField)
	}
	discriminator, _ := expression["wire_discriminator"].(map[string]any)
	if discriminator["field"] != "type_name" || discriminator["value"] != "expression" {
		t.Fatalf("Expression wire discriminator is missing: %#v", expression)
	}
	functions, _ := expression["function_suggestions"].([]any)
	if !slices.Contains(functions, any("math.sqrt()")) {
		t.Fatalf("installed Flow360 math suggestions were not projected: %#v", functions)
	}
	momentCenter := findQuantitySchema(findSchemaByTitle(caseSchema, "Moment Center"))
	valueSchema, _ := momentCenter["value_schema"].(map[string]any)
	if momentCenter == nil || valueSchema["type"] != "array" || valueSchema["minItems"] != float64(3) {
		t.Fatalf("expected a three-component Moment Center quantity, got %#v", momentCenter)
	}
}

func TestInstalledSchemaRestoresOmittedAutomatedFarfieldMethod(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	params := json.RawMessage(`{
		"version":"25.10.18",
		"unit_system":{"name":"SI"},
		"meshing":{"type_name":"MeshingParams","volume_zones":[{"name":"Farfield","type":"AutomatedFarfield"}]}
	}`)
	result, err := NewClient().PreflightSimulationParams(context.Background(), "Geometry", "case", params)
	if err != nil {
		t.Fatal(err)
	}
	for _, issue := range result.Issues {
		if issue.Code == "key_error" && issue.Message == "'method'" {
			t.Fatalf("omitted schema default escaped as raw method KeyError: %#v", issue)
		}
	}
}

func TestInstalledOutputSchemaProjectsEntityListsWithCanonicalPayloads(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	params, err := os.ReadFile(filepath.Join("..", "..", "tutorials", "T05-wake-volume-refinement", "simulation.json"))
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewClient().PreflightSimulationParams(context.Background(), "Geometry", "case", params)
	if err != nil {
		t.Fatal(err)
	}
	var caseSchema map[string]any
	if err := json.Unmarshal(result.EditorSchemas["Case"], &caseSchema); err != nil {
		t.Fatal(err)
	}
	surfaceOutput := findSchemaByTitle(caseSchema, "SurfaceOutput")
	if surfaceOutput == nil {
		t.Fatal("SurfaceOutput variant is missing from the Case editor schema")
	}
	properties, _ := surfaceOutput["properties"].(map[string]any)
	entities, _ := properties["surfaces"].(map[string]any)
	if entities == nil {
		entities, _ = properties["entities"].(map[string]any)
	}
	choices, _ := entities["entity_choices"].([]any)
	if entities["type"] != "entity_list" || len(choices) < 1 {
		t.Fatalf("SurfaceOutput did not project selectable canonical surfaces: %#v", entities)
	}
	var surfaceChoice map[string]any
	for _, raw := range choices {
		choice := raw.(map[string]any)
		if choice["model_type"] == "Surface" {
			surfaceChoice = choice
			break
		}
	}
	payload, _ := surfaceChoice["payload"].(map[string]any)
	if payload["private_attribute_id"] == nil || payload["private_attribute_entity_type_name"] != "Surface" {
		t.Fatalf("surface choice lost its canonical Flow360 payload: %#v", surfaceChoice)
	}
	sliceOutput := findSchemaByTitle(caseSchema, "SliceOutput")
	if sliceOutput == nil {
		t.Fatal("SliceOutput variant is missing from the Case editor schema")
	}
	sliceProperties, _ := sliceOutput["properties"].(map[string]any)
	slices, _ := sliceProperties["slices"].(map[string]any)
	if slices == nil {
		slices, _ = sliceProperties["entities"].(map[string]any)
	}
	sliceChoices, _ := slices["entity_choices"].([]any)
	if slices["type"] != "entity_list" || len(sliceChoices) != 1 {
		t.Fatalf("SliceOutput did not restrict selection to registered Slice entities: %#v", slices)
	}
	slicePayload := sliceChoices[0].(map[string]any)["payload"].(map[string]any)
	if slicePayload["name"] != "Wake center plane" || slicePayload["private_attribute_entity_type_name"] != "Slice" {
		t.Fatalf("Slice output choice lost its registered Draft entity payload: %#v", slicePayload)
	}
}

func TestInstalledSchemaValidatesTypedExpressionWireAndDimensions(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	// Draft.get_simulation_params() omits version/unit_system because that
	// metadata is implicit in the remote Draft context. Preflight must still
	// exercise Flow360's typed Expression dimension validation.
	base := `{"time_stepping":{"type_name":"Unsteady","steps":10,"step_size":%s}}`
	invalid := fmt.Sprintf(base, `{"type_name":"expression","expression":"1 * u.m"}`)
	result, err := NewClient().PreflightSimulationParams(context.Background(), "Geometry", "case", json.RawMessage(invalid))
	if err != nil {
		t.Fatal(err)
	}
	if !preflightHasIssueAt(result, "time_stepping.step_size") {
		t.Fatalf("wrong Expression dimensions were not reported: %#v", result.Issues)
	}
	valid := fmt.Sprintf(base, `{"type_name":"expression","expression":"(123 - 5) * u.s"}`)
	result, err = NewClient().PreflightSimulationParams(context.Background(), "Geometry", "case", json.RawMessage(valid))
	if err != nil {
		t.Fatal(err)
	}
	if preflightHasIssueAt(result, "time_stepping.step_size") {
		t.Fatalf("valid typed Expression was rejected: %#v", result.Issues)
	}
}

func preflightHasIssueAt(result PreflightResult, path string) bool {
	for _, issue := range result.Issues {
		if issue.Path == path || strings.HasPrefix(issue.Path, path+".") {
			return true
		}
	}
	return false
}

func TestLegacyMesherTargetCountProducesRemovalRecovery(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	current := json.RawMessage(`{
		"version":"25.10.3",
		"unit_system":{"name":"SI"},
		"meshing":{"type_name":"MeshingParams","defaults":{"target_surface_node_count":100000}}
	}`)
	result, err := NewClient().PreflightSimulationParams(
		context.Background(),
		"Geometry",
		"surface-mesh",
		current,
	)
	if err != nil {
		t.Fatal(err)
	}
	var recovery map[string]any
	if err := json.Unmarshal(result.FormSchema, &recovery); err != nil {
		t.Fatal(err)
	}
	leaf := findSchemaByType(recovery, "field_removal")
	if leaf == nil {
		t.Fatalf("expected an incompatible-field removal recovery, got issues=%#v schema=%s", result.Issues, result.FormSchema)
	}
	values := json.RawMessage(`{"meshing":{"defaults":{"surface_max_edge_length":{"value":0.1,"units":"m"},"target_surface_node_count":null}}}`)
	if err := plans.ValidateFormValues(result.FormSchema, values); err != nil {
		t.Fatal(err)
	}
	expanded, err := plans.ExpandFormValues(result.FormSchema, values, current)
	if err != nil || !strings.Contains(string(expanded), `"target_surface_node_count":null`) {
		t.Fatalf("recovery did not produce a field removal: %s / %v", expanded, err)
	}
	var currentObject, removalPatch map[string]any
	if json.Unmarshal(current, &currentObject) != nil || json.Unmarshal(expanded, &removalPatch) != nil {
		t.Fatal("could not decode recovery merge patch")
	}
	revalidatedParams, _ := json.Marshal(mergePreflightFixture(currentObject, removalPatch))
	revalidated, err := NewClient().PreflightSimulationParams(
		context.Background(), "Geometry", "surface-mesh", revalidatedParams,
	)
	if err != nil || !revalidated.Valid {
		t.Fatalf("field-removal recovery did not clear preflight: %#v / %v", revalidated, err)
	}
}

func TestExtraForbiddenProducesRemovalRecovery(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	current := json.RawMessage(`{
		"version":"25.10.3",
		"unit_system":{"name":"SI"},
		"agent_obsolete_field":true
	}`)
	result, err := NewClient().PreflightSimulationParams(context.Background(), "Geometry", "case", current)
	if err != nil {
		t.Fatal(err)
	}
	var recovery map[string]any
	if json.Unmarshal(result.FormSchema, &recovery) != nil {
		t.Fatal("could not decode recovery schema")
	}
	leaf := findSchemaByType(recovery, "field_removal")
	if leaf == nil || leaf["path"] != "agent_obsolete_field" {
		t.Fatalf("extra_forbidden did not produce a typed removal: issues=%#v schema=%s", result.Issues, result.FormSchema)
	}
	recommendation, _ := leaf["recommendation"].(map[string]any)
	if recommendation["confidence"] != "high" || recommendation["provenance"] != "flow360_schema_validation" {
		t.Fatalf("field removal lacks authoritative recommendation evidence: %#v", leaf)
	}
}

func findSchemaByType(node map[string]any, nodeType string) map[string]any {
	if node["type"] == nodeType {
		return node
	}
	if properties, ok := node["properties"].(map[string]any); ok {
		for _, child := range properties {
			if object, ok := child.(map[string]any); ok {
				if found := findSchemaByType(object, nodeType); found != nil {
					return found
				}
			}
		}
	}
	if variants, ok := node["variants"].([]any); ok {
		for _, child := range variants {
			if object, ok := child.(map[string]any); ok {
				if found := findSchemaByType(object, nodeType); found != nil {
					return found
				}
			}
		}
	}
	return nil
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
	entityChoices := models["entity_choices"].([]any)
	if len(models["model_choices"].([]any)) == 0 || len(entityChoices) == 0 {
		t.Fatalf("expected model and boundary entity choices, got %#v", models)
	}
	recommendation, ok := models["recommendation"].(map[string]any)
	if !ok || recommendation["confidence"] != "high" {
		t.Fatalf("expected a high-confidence inherited model recommendation, got %#v", models)
	}
	if len(models["default_entities"].([]any)) != len(entityChoices) {
		t.Fatalf("expected all reported boundaries to be preselected, got %#v", models)
	}

	modelChoice := models["default_model"].(string)
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
		if value == nil {
			delete(result, key)
			continue
		}
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
