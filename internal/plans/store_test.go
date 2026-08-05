package plans

import (
	"encoding/json"
	"errors"
	"strings"
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

func TestCompileDerivesAuditIntentWhenAIGuidanceIsOmitted(t *testing.T) {
	plan, err := Compile(CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "surface-mesh", Name: "manual mesh", Patch: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Intent != "Compile and validate reviewed parameters for Geometry → SurfaceMesh." {
		t.Fatalf("unexpected derived audit intent %q", plan.Intent)
	}
}

func TestCompilePreservesEngineeringEvidence(t *testing.T) {
	plan, err := Compile(CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "surface-mesh", Name: "semantic review", Intent: "Review CFD semantics.",
		Patch: json.RawMessage(`{}`),
		Evidence: []Evidence{{
			Key: "surface_semantics", Value: []any{map[string]any{"surface": "wing", "role": "wall"}},
			Provenance: "provided", Description: "Reviewed surface role.",
		}},
		ValidationHints: []string{"Map roles to the active Flow360 schema"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Evidence) != 1 || plan.Evidence[0].Key != "surface_semantics" {
		t.Fatalf("expected evidence to be preserved, got %#v", plan.Evidence)
	}
	if len(plan.ValidationHints) != 1 {
		t.Fatalf("expected validation hints, got %#v", plan.ValidationHints)
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
		Target: "case", Name: "baseline", Intent: "Run baseline.",
		Baseline: json.RawMessage(`{"simulation_params":{"version":"test"}}`),
		Patch:    json.RawMessage(`{}`),
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
	if len(loaded.Baseline) == 0 {
		t.Fatal("baseline was not persisted")
	}
	public, err := json.Marshal(loaded)
	if err != nil {
		t.Fatal(err)
	}
	var publicObject map[string]any
	if err := json.Unmarshal(public, &publicObject); err != nil {
		t.Fatal(err)
	}
	if _, exists := publicObject["baseline"]; exists {
		t.Fatal("private baseline leaked through the public plan JSON")
	}
}

func TestStoreCanRunEnforcesApprovalAndNoSubmission(t *testing.T) {
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
	if _, err := store.CanRun(created.ID); err == nil {
		t.Fatal("expected draft plan to be rejected")
	}

	_, err = store.Update(created.ID, func(plan *Plan) error {
		plan.Status = StatusApproved
		plan.ApprovedAt = &plan.UpdatedAt
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetPreflight(created.ID, Preflight{
		SchemaVersion: 1, Valid: true, ValidatedRevision: created.Revision,
		FormSchema: json.RawMessage(`{"type":"object","properties":{}}`),
	}); err != nil {
		t.Fatal(err)
	}
	plan, err := store.CanRun(created.ID)
	if err != nil {
		t.Fatalf("approved plan should be runnable, got %v", err)
	}
	if plan.Status != StatusApproved {
		t.Fatalf("expected approved status, got %q", plan.Status)
	}

	_, err = store.SetRunning(created.ID, "sub-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CanRun(created.ID); err == nil || !strings.Contains(err.Error(), ErrDoubleSubmitProtect) {
		t.Fatalf("expected double-submit protection, got %v", err)
	}
}

func TestStoreMarkSubmittedStoresRemoteIDs(t *testing.T) {
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
	if _, err := store.Update(created.ID, func(p *Plan) error { p.Status = StatusApproved; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetPreflight(created.ID, Preflight{
		SchemaVersion: 1, Valid: true, ValidatedRevision: created.Revision,
		FormSchema: json.RawMessage(`{"type":"object","properties":{}}`),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetRunning(created.ID, "sub-abc"); err != nil {
		t.Fatal(err)
	}
	result := json.RawMessage(`{"project_id":"p1","draft_id":"d1","case_id":"c1","solver_version":"2025.1"}`)
	submitted, err := store.MarkSubmitted(created.ID, result)
	if err != nil {
		t.Fatal(err)
	}
	if submitted.Status != StatusSubmitted {
		t.Fatalf("expected submitted, got %q", submitted.Status)
	}
	if submitted.RemoteIDs == nil || submitted.RemoteIDs.CaseID != "c1" {
		t.Fatalf("expected remote case id, got %#v", submitted.RemoteIDs)
	}
	if submitted.SubmissionID != "sub-abc" {
		t.Fatalf("expected submission id preserved, got %q", submitted.SubmissionID)
	}
}

func TestStoreMarkSubmittedStoresNestedFlow360RemoteIDs(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateInput{
		ProjectID: "prj-local", SourceID: "geo-1", SourceType: "Geometry",
		Target: "case", Name: "nested result", Intent: "Run case.", Patch: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	result := json.RawMessage(`{
		"draft":{"id":"dft-1","type":"Draft","project_id":"prj-1","solver_version":"release-25.10"},
		"result":{"id":"case-1","type":"Case","mesh_id":"vm-1","status":"pending"}
	}`)
	submitted, err := store.MarkSubmitted(created.ID, result)
	if err != nil {
		t.Fatal(err)
	}
	if submitted.RemoteIDs == nil || submitted.RemoteIDs.DraftID != "dft-1" ||
		submitted.RemoteIDs.CaseID != "case-1" || submitted.RemoteIDs.MeshID != "vm-1" ||
		submitted.RemoteIDs.ProjectID != "prj-1" {
		t.Fatalf("unexpected nested remote IDs: %#v", submitted.RemoteIDs)
	}
}

func TestStoreSetRemoteIDsBackfillsWithoutOverwriting(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "case", Name: "legacy", Intent: "Run case.", Patch: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := store.SetRemoteIDs(created.ID, &RemoteIDs{DraftID: "dft-1", CaseID: "case-1"})
	if err != nil {
		t.Fatal(err)
	}
	updated, err = store.SetRemoteIDs(updated.ID, &RemoteIDs{DraftID: "wrong", MeshID: "vm-1"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.RemoteIDs.DraftID != "dft-1" || updated.RemoteIDs.CaseID != "case-1" || updated.RemoteIDs.MeshID != "vm-1" {
		t.Fatalf("unexpected merged remote IDs: %#v", updated.RemoteIDs)
	}
}

func TestStoreMarkFailedClassifiesError(t *testing.T) {
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
	if _, err := store.Update(created.ID, func(p *Plan) error { p.Status = StatusApproved; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetPreflight(created.ID, Preflight{
		SchemaVersion: 1, Valid: true, ValidatedRevision: created.Revision,
		FormSchema: json.RawMessage(`{"type":"object","properties":{}}`),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetRunning(created.ID, "sub-err"); err != nil {
		t.Fatal(err)
	}
	failed, err := store.MarkFailed(created.ID, errors.New("request timeout while contacting Flow360"))
	if err != nil {
		t.Fatal(err)
	}
	if failed.Status != StatusFailed {
		t.Fatalf("expected failed, got %q", failed.Status)
	}
	if failed.ErrorCategory != ErrorTimeout {
		t.Fatalf("expected timeout category, got %q", failed.ErrorCategory)
	}
	if failed.SubmissionID != "" {
		t.Fatalf("expected submission id cleared, got %q", failed.SubmissionID)
	}
}

func TestStoreRecoverInterruptedMarksRunningPlansReconciling(t *testing.T) {
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
	if _, err := store.Update(created.ID, func(p *Plan) error {
		p.Status = StatusRunning
		p.StartedAt = &p.UpdatedAt
		p.SubmissionID = "sub-1"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.recoverInterrupted(); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Status != StatusReconciling {
		t.Fatalf("expected reconciling after restart, got %q", loaded.Status)
	}
	if loaded.SubmissionID == "" {
		t.Fatal("expected submission id to be preserved across recovery")
	}
}

func TestStoreRecoveryKeepsSubmittedPlansSubmitted(t *testing.T) {
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
	if _, err := store.Update(created.ID, func(plan *Plan) error {
		plan.Status = StatusSubmitted
		plan.SubmissionID = "sub-1"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(store.dir)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := reopened.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Status != StatusSubmitted {
		t.Fatalf("submitted plan regressed to %q after restart", loaded.Status)
	}
}

func TestStoreCreateIsIdempotentByKey(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := CreateInput{
		ProjectID: "prj-1", SourceID: "case-1", SourceType: "Case",
		Target: "case", Name: "alpha 5", Intent: "Sweep alpha.", Patch: json.RawMessage(`{"alpha":5}`),
		IdempotencyKey: "sweep-case-1-alpha-5",
	}
	first, err := store.Create(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Create(input)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("idempotent create produced %q and %q", first.ID, second.ID)
	}
}

func TestClassifyErrorDetectsCategories(t *testing.T) {
	cases := []struct {
		msg      string
		category ErrorCategory
	}{
		{"request timeout", ErrorTimeout},
		{"context deadline exceeded", ErrorTimeout},
		{"unauthorized", ErrorAuth},
		{"401 forbidden", ErrorAuth},
		{"validation rejected", ErrorValidation},
		{"invalid payload", ErrorValidation},
		{"503 service unavailable", ErrorNetwork},
		{"network unreachable", ErrorNetwork},
		{"something unexpected", ErrorUnknown},
	}
	for _, c := range cases {
		got := classifyError(errors.New(c.msg))
		if got != c.category {
			t.Fatalf("message %q: expected %q, got %q", c.msg, c.category, got)
		}
	}
}

func TestExtractRemoteIDsSelectsKnownFields(t *testing.T) {
	result := json.RawMessage(`{"project_id":"p1","draft_id":"d1","case_id":"c1","solver_version":"2025.1","unrelated":"x"}`)
	ids := ExtractRemoteIDs(result)
	if ids == nil {
		t.Fatal("expected remote ids")
	}
	if ids.ProjectID != "p1" || ids.DraftID != "d1" || ids.CaseID != "c1" || ids.SolverVersion != "2025.1" {
		t.Fatalf("unexpected ids: %#v", ids)
	}
	if ExtractRemoteIDs(json.RawMessage(`{"unrelated":"x"}`)) != nil {
		t.Fatal("expected nil when no known ids")
	}
}
