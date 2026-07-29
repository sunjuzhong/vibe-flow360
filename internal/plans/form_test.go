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
			"length":{"type":"quantity","value_schema":{"type":"number","exclusiveMinimum":0}},
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
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateFormValues(schema, value); err == nil {
				t.Fatal("expected invalid dynamic form values to be rejected")
			}
		})
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
