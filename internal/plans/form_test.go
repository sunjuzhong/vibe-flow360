package plans

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateFormValuesSupportsSchemaDrivenTypes(t *testing.T) {
	schema := json.RawMessage(`{
		"type":"object",
		"required":["length","enabled","mode","tags"],
		"properties":{
			"length":{"type":"quantity","unit_options":["m","mm"],"value_schema":{"type":"number","exclusiveMinimum":0}},
			"enabled":{"type":"boolean"},
			"mode":{"type":"enum","options":["steady","unsteady"]},
			"tags":{"type":"array","minItems":1,"items":{"type":"string"}}
		}
	}`)
	valid := json.RawMessage(`{
		"length":{"value":0.01,"units":"m"},
		"enabled":true,
		"mode":"steady",
		"tags":["baseline"]
	}`)
	if err := ValidateFormValues(schema, valid); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]json.RawMessage{
		"unknown":  json.RawMessage(`{"length":{"value":1},"enabled":true,"mode":"steady","tags":["a"],"other":1}`),
		"negative": json.RawMessage(`{"length":{"value":0},"enabled":true,"mode":"steady","tags":["a"]}`),
		"enum":     json.RawMessage(`{"length":{"value":1},"enabled":true,"mode":"invalid","tags":["a"]}`),
		"unit":     json.RawMessage(`{"length":{"value":1,"units":"parsec"},"enabled":true,"mode":"steady","tags":["a"]}`),
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateFormValues(schema, value); err == nil {
				t.Fatal("expected invalid dynamic form values to be rejected")
			}
		})
	}
}

func TestQuantityUnitsNormalizeOnlyDeclaredFlow360Aliases(t *testing.T) {
	schema := json.RawMessage(`{
		"type":"object","required":["length"],"properties":{
			"length":{"type":"quantity","unit_options":["m","mm"],
				"unit_aliases":{"meter":"m"},"value_schema":{"type":"number"}}
		}
	}`)
	legacy := json.RawMessage(`{"length":{"value":1,"units":"meter"}}`)
	if err := ValidateFormValues(schema, legacy); err != nil {
		t.Fatalf("declared legacy alias was rejected: %v", err)
	}
	expanded, err := ExpandFormValues(schema, legacy, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if string(expanded) != `{"length":{"units":"m","value":1}}` {
		t.Fatalf("expected canonical Flow360 wire token, got %s", expanded)
	}
	for _, invalid := range []json.RawMessage{
		json.RawMessage(`{"length":{"value":1,"units":"centimeter"}}`),
		json.RawMessage(`{"length":{"value":1}}`),
	} {
		if err := ValidateFormValues(schema, invalid); err == nil {
			t.Fatalf("expected undeclared or missing unit to be rejected: %s", invalid)
		}
	}
}

func TestExpandFormValuesUpdatesExistingBoundaryModelFromServerChoices(t *testing.T) {
	schema := json.RawMessage(`{
		"type":"object","required":["models"],"properties":{"models":{
			"type":"entity_assignment",
			"model_choices":[{"value":"existing:0","label":"Wall","model_type":"Wall","entity_property":"surfaces","index":0}],
			"entity_choices":[
				{"value":"face-1","label":"face-1","payload":{"name":"face-1","private_attribute_entity_type_name":"Surface","private_attribute_id":"face-1"}},
				{"value":"face-2","label":"face-2","payload":{"name":"face-2","private_attribute_entity_type_name":"Surface","private_attribute_id":"face-2"}}
			]
		}}
	}`)
	values := json.RawMessage(`{"models":{"model":"existing:0","entities":["face-1","face-2"]}}`)
	current := json.RawMessage(`{"models":[
		{"type":"Wall","name":"Wall","entities":{"stored_entities":[{"name":"*"}]},"private_attribute_id":"wall-id"},
		{"type":"Fluid","name":"Fluid"}
	]}`)
	if err := ValidateFormValues(schema, values); err != nil {
		t.Fatal(err)
	}
	expanded, err := ExpandFormValues(schema, values, current)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(expanded, &result); err != nil {
		t.Fatal(err)
	}
	models := result["models"].([]any)
	wall := models[0].(map[string]any)
	if _, exists := wall["entities"]; exists {
		t.Fatal("legacy entity assignment was not removed")
	}
	surfaces := wall["surfaces"].(map[string]any)["stored_entities"].([]any)
	if len(surfaces) != 2 || wall["private_attribute_id"] != "wall-id" {
		t.Fatalf("boundary assignment did not preserve and update the model: %#v", wall)
	}
	if models[1].(map[string]any)["type"] != "Fluid" {
		t.Fatal("unrelated models were not preserved")
	}
}

func TestStoreApplyInputsInvalidatesApprovalAndIncrementsRevision(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "surface-mesh", Name: "mesh", Intent: "Build the baseline mesh.",
		Baseline: json.RawMessage(`{"simulation_params":{"meshing":{"defaults":{}}}}`),
		Patch:    json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	formSchema := json.RawMessage(`{
		"type":"object","required":["meshing"],"properties":{
			"meshing":{"type":"object","required":["defaults"],"properties":{
				"defaults":{"type":"object","required":["surface_max_edge_length"],"properties":{
					"surface_max_edge_length":{"type":"quantity","value_schema":{"type":"number","exclusiveMinimum":0}}
				}}
			}}
		}
	}`)
	if _, err := store.SetPreflight(created.ID, Preflight{
		SchemaVersion: 1, Valid: true, ValidatedRevision: created.Revision,
		FormSchema: formSchema,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(created.ID, func(plan *Plan) error {
		plan.Status = StatusApproved
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	values := json.RawMessage(`{"meshing":{"defaults":{"surface_max_edge_length":{"value":0.01,"units":"m"}}}}`)
	updated, err := store.ApplyInputs(created.ID, created.Revision, values)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != created.Revision+1 || updated.Status != StatusDraft || updated.Preflight != nil {
		t.Fatalf("unexpected updated plan %#v", updated)
	}
	if updated.ApprovedAt != nil {
		t.Fatal("editing inputs did not invalidate approval")
	}
	if !strings.Contains(string(updated.Patch), "surface_max_edge_length") {
		t.Fatalf("input was not merged into patch: %s", updated.Patch)
	}
	if _, err := store.ApplyInputs(created.ID, created.Revision, values); err == nil {
		t.Fatal("expected stale revision to be rejected")
	}
}
