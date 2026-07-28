package plans

import (
	"encoding/json"
	"testing"
)

func TestCompileBuildsSemanticDiff(t *testing.T) {
	plan, err := Compile(CreateInput{
		ProjectID:  "prj-1",
		SourceID:   "case-1",
		SourceType: "Case",
		Target:     "case",
		Name:       "AoA 4 deg",
		Intent:     "Compare lift at four degrees.",
		Baseline:   json.RawMessage(`{"simulation_params":{"operating_condition":{"alpha":{"value":0}}}}`),
		Patch:      json.RawMessage(`{"operating_condition":{"alpha":{"value":4}}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Differences) != 1 {
		t.Fatalf("expected one difference, got %#v", plan.Differences)
	}
	if plan.Differences[0].Path != "operating_condition.alpha.value" {
		t.Fatalf("unexpected diff path %q", plan.Differences[0].Path)
	}
	if plan.Status != StatusDraft {
		t.Fatalf("unexpected status %q", plan.Status)
	}
}

func TestCompileRejectsPrivateAttributes(t *testing.T) {
	plan, err := Compile(CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "surface-mesh", Name: "mesh", Intent: "Generate surface mesh.",
		Patch: json.RawMessage(`{"private_attribute_asset_cache":{}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, validation := range plan.Validations {
		if validation.Level == "error" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected private attribute validation error")
	}
}

func TestCompileValidatesPhysicalRanges(t *testing.T) {
	plan, err := Compile(CreateInput{
		ProjectID: "prj-1", SourceID: "case-1", SourceType: "Case",
		Target: "case", Name: "invalid", Intent: "Validate input.",
		Patch: json.RawMessage(`{"operating_condition":{"alpha":{"value":120}},"time_stepping":{"max_steps":0}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	errors := 0
	for _, validation := range plan.Validations {
		if validation.Level == "error" {
			errors++
		}
	}
	if errors != 2 {
		t.Fatalf("expected two range errors, got %#v", plan.Validations)
	}
}

func TestStorePersistsPlan(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateInput{
		ProjectID: "prj-1", SourceID: "vm-1", SourceType: "VolumeMesh",
		Target: "case", Name: "baseline", Intent: "Run baseline.", Patch: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Name != created.Name || loaded.Status != StatusDraft {
		t.Fatalf("unexpected persisted plan %#v", loaded)
	}
}
