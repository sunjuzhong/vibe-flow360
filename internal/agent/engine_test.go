package agent

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func setupTestEngine(t *testing.T) (*Engine, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := NewInterventionStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	planStore, err := plans.NewStore(filepath.Join(dir, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	engine := NewEngine(store, planStore, nil)
	return engine, dir
}

func setupTestEngineWithAI(t *testing.T) (*Engine, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := NewInterventionStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	planStore, err := plans.NewStore(filepath.Join(dir, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	ai := &Service{
		APIKey:  "test-key",
		BaseURL: "https://api.test.com/v1",
		Model:   "test-model",
	}
	ai.Client = &http.Client{Timeout: 5 * time.Second}
	engine := NewEngine(store, planStore, ai)
	return engine, dir
}

func makeTestPlan(projectID, planID, sourceID string, preflightValid bool, issues []plans.PreflightIssue) plans.Plan {
	return plans.Plan{
		ID:          planID,
		ProjectID:   projectID,
		ProjectName: "Test Project",
		SourceID:    sourceID,
		SourceType:  "VolumeMesh",
		SourceName:  "test-mesh",
		Target:      "case",
		Name:        "test-case",
		Intent:      "Testing",
		Patch:       json.RawMessage(`{"cfl_number":5}`),
		Preflight:   &plans.Preflight{Valid: preflightValid, Issues: issues, SchemaVersion: 1},
		Status:      plans.StatusDraft,
	}
}

func TestEngineCreateFromPreflightError(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	if intervention.Type != TypePreflightError {
		t.Errorf("expected type %s, got %s", TypePreflightError, intervention.Type)
	}
	if intervention.State != InterventionObservation {
		t.Errorf("expected state %s, got %s", InterventionObservation, intervention.State)
	}
	if len(intervention.Evidence) != 1 {
		t.Errorf("expected 1 evidence, got %d", len(intervention.Evidence))
	}
	if intervention.ProjectID != "proj-1" {
		t.Errorf("expected project proj-1, got %s", intervention.ProjectID)
	}
}

func TestEngineCreateFromPreflightErrorValidPlan(t *testing.T) {
	engine, _ := setupTestEngine(t)

	plan := makeTestPlan("proj-1", "plan-1", "vm-1", true, nil)

	_, err := engine.CreateFromPreflightError(plan)
	if err == nil {
		t.Fatal("expected error for valid preflight")
	}
}

func TestEngineCreateFromRunError(t *testing.T) {
	engine, _ := setupTestEngine(t)

	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, nil)
	plan.Preflight = nil

	intervention, err := engine.CreateFromRunError(plan, errors.New("authentication failed"))
	if err != nil {
		t.Fatal(err)
	}

	if intervention.Type != TypeRemoteError {
		t.Errorf("expected type %s, got %s", TypeRemoteError, intervention.Type)
	}
	if len(intervention.Evidence) != 1 {
		t.Errorf("expected 1 evidence, got %d", len(intervention.Evidence))
	}
}

func TestEngineFullLifecycle(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	current, err := engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.State != InterventionDiagnosis {
		t.Errorf("expected state %s, got %s", InterventionDiagnosis, current.State)
	}
	if current.Diagnosis == nil {
		t.Fatal("expected diagnosis to be set")
	}

	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.State != InterventionProposal {
		t.Errorf("expected state %s, got %s", InterventionProposal, current.State)
	}
	if len(current.Proposals) == 0 {
		t.Fatal("expected proposals to be generated")
	}

	selected := current.Proposals[0]
	current, err = engine.SelectProposalAndAdvance(intervention.ID, selected.ID, "more conservative")
	if err != nil {
		t.Fatal(err)
	}
	if current.State != InterventionUserFeedback {
		t.Fatalf("expected feedback state, got %s", current.State)
	}
	current, err = engine.SetFeedbackAndCompile(intervention.ID, "more conservative")
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.State != InterventionValidation {
		t.Errorf("expected state %s, got %s", InterventionValidation, current.State)
	}
	if len(current.CompiledPatch) == 0 {
		t.Fatal("expected compiled patch")
	}

	current, err = engine.CompleteValidation(intervention.ID, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if current.State != InterventionResolved {
		t.Errorf("expected state %s, got %s", InterventionResolved, current.State)
	}
	if current.Validation == nil || !current.Validation.Valid {
		t.Error("expected valid validation result")
	}
}

func TestEngineValidationFailureRollsBack(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	current, err := engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(current.Proposals) == 0 {
		t.Fatal("expected proposals")
	}

	selected := current.Proposals[0]
	current, err = engine.SelectProposalAndAdvance(intervention.ID, selected.ID, "test")
	if err != nil {
		t.Fatal(err)
	}

	current, err = engine.SetFeedbackAndCompile(intervention.ID, "test")
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	current, err = engine.CompleteValidation(intervention.ID, false, []string{"Still invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if current.State != InterventionFailed {
		t.Errorf("expected state %s after failed validation, got %s", InterventionFailed, current.State)
	}
}

func TestEngineRetryFromFailed(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	current, err := engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	selected := current.Proposals[0]
	current, err = engine.SelectProposalAndAdvance(intervention.ID, selected.ID, "test")
	if err != nil {
		t.Fatal(err)
	}

	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	current, err = engine.CompleteValidation(intervention.ID, false, []string{"Still invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if current.State != InterventionFailed {
		t.Fatal("expected failed state")
	}

	retried, err := engine.RetryFromFailed(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if retried.State != InterventionObservation {
		t.Errorf("expected state %s after retry, got %s", InterventionObservation, retried.State)
	}
	if len(retried.Proposals) != 0 {
		t.Error("expected proposals to be cleared after retry")
	}
	if retried.SelectedProposal != nil {
		t.Error("expected selected proposal to be cleared after retry")
	}
	if retried.CompiledPatch != nil {
		t.Error("expected compiled patch to be cleared after retry")
	}
}

func TestEngineList(t *testing.T) {
	engine, dir := setupTestEngine(t)

	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, []plans.PreflightIssue{
		{Code: "E1", Level: "error", Path: "x", Message: "msg", Stages: nil},
	})

	_, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	list, err := engine.List("proj-1", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Errorf("expected 1 intervention, got %d", len(list))
	}

	list, err = engine.List("proj-2", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Errorf("expected 0 interventions for different project, got %d", len(list))
	}

	_ = dir
}

func TestEngineClose(t *testing.T) {
	engine, _ := setupTestEngine(t)

	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, []plans.PreflightIssue{
		{Code: "E1", Level: "error", Path: "x", Message: "msg", Stages: nil},
	})

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	closed, err := engine.Close(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if closed.State != InterventionClosed {
		t.Errorf("expected closed state, got %s", closed.State)
	}
}

func TestMergeFeedbackConservative(t *testing.T) {
	patch := json.RawMessage(`{"cfl_number":5,"relaxation_factor":1.5}`)
	result := mergeFeedbackIntoPatch(patch, "make it more conservative")

	var parsed map[string]interface{}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	for key := range parsed {
		if strings.HasPrefix(key, "_feedback") {
			t.Fatalf("feedback audit metadata leaked into SimulationParams: %s", key)
		}
	}
	if cfl, ok := parsed["cfl_number"].(float64); !ok || cfl >= 5 {
		t.Errorf("expected reduced CFL, got %v", parsed["cfl_number"])
	}
	if relax, ok := parsed["relaxation_factor"].(float64); !ok || relax >= 1.5 {
		t.Errorf("expected reduced relaxation factor, got %v", parsed["relaxation_factor"])
	}
}

func TestMergeFeedbackAggressive(t *testing.T) {
	patch := json.RawMessage(`{"cfl_number":5}`)
	result := mergeFeedbackIntoPatch(patch, "make it more aggressive")

	var parsed map[string]interface{}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	if cfl, ok := parsed["cfl_number"].(float64); !ok || cfl <= 5 {
		t.Errorf("expected increased CFL, got %v", parsed["cfl_number"])
	}
}

func TestMergeFeedbackSimplify(t *testing.T) {
	patch := json.RawMessage(`{"turbulence_model":"k_epsilon"}`)
	result := mergeFeedbackIntoPatch(patch, "simplify the model")

	var parsed map[string]interface{}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["turbulence_model"] != "spalart_allmaras" {
		t.Errorf("expected simplified turbulence model, got %v", parsed["turbulence_model"])
	}
}

func TestMergeFeedbackEmptyPatch(t *testing.T) {
	result := mergeFeedbackIntoPatch(nil, "reduce cfl")

	var parsed map[string]interface{}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	if _, ok := parsed["cfl_number"]; !ok {
		t.Error("expected deterministic feedback adjustment on empty patch")
	}
}

func TestClassifyRunError(t *testing.T) {
	tests := []struct {
		err      error
		expected string
	}{
		{errors.New("authentication failed"), ErrorAuthentication},
		{errors.New("timeout exceeded"), ErrorTimeout},
		{errors.New("connection refused"), ErrorNetwork},
		{errors.New("invalid input"), ErrorSchemaViolation},
		{errors.New("unexpected error"), ErrorUnknown},
	}

	for _, tt := range tests {
		result := classifyRunError(tt.err)
		if result != tt.expected {
			t.Errorf("classifyRunError(%q) = %q, expected %q", tt.err.Error(), result, tt.expected)
		}
	}
}

func TestErrorCategoryToType(t *testing.T) {
	tests := []struct {
		category string
		expected string
	}{
		{ErrorAuthentication, TypeRemoteError},
		{ErrorTimeout, TypeRemoteError},
		{ErrorNetwork, TypeRemoteError},
		{ErrorSchemaViolation, TypePreflightError},
		{ErrorMissingInputs, TypePreflightError},
		{ErrorSolverDivergence, TypeSolverFailure},
		{ErrorUnknown, TypeRemoteError},
		{"unmapped", TypeRemoteError},
	}

	for _, tt := range tests {
		result := mapErrorCategoryToType(tt.category)
		if result != tt.expected {
			t.Errorf("mapErrorCategoryToType(%q) = %q, expected %q", tt.category, result, tt.expected)
		}
	}
}

func TestEngineGenerateProposalsWithoutAI(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	current, err := engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	if len(current.Proposals) == 0 {
		t.Fatal("expected fallback proposals when AI is unavailable")
	}

	hasValidPatch := false
	for _, p := range current.Proposals {
		if len(p.Patch) > 0 {
			hasValidPatch = true
			break
		}
	}
	if !hasValidPatch {
		t.Error("expected at least one proposal with a valid patch")
	}
}

func TestEngineWithAIKey(t *testing.T) {
	engine, _ := setupTestEngineWithAI(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	proposals := engine.buildProposalsWithAI(intervention)
	if len(proposals) == 0 {
		t.Fatal("expected proposals even when AI is unreachable (fallback)")
	}
}

func TestInterventionStoreListWithFilters(t *testing.T) {
	dir := t.TempDir()
	store, err := NewInterventionStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan1 := makeTestPlan("proj-A", "plan-1", "res-1", false, []plans.PreflightIssue{
		{Code: "E1", Level: "error", Path: "x", Message: "m", Stages: nil},
	})
	plan2 := makeTestPlan("proj-B", "plan-2", "res-2", false, []plans.PreflightIssue{
		{Code: "E2", Level: "error", Path: "y", Message: "n", Stages: nil},
	})

	engine, _ := setupTestEngine(t)
	engine.store = store

	_, err = engine.CreateFromPreflightError(plan1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = engine.CreateFromPreflightError(plan2)
	if err != nil {
		t.Fatal(err)
	}

	list, err := store.List("proj-A", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Errorf("expected 1 intervention for proj-A, got %d", len(list))
	}

	list, err = store.List("", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 interventions total, got %d", len(list))
	}
}

func TestInterventionStoreCleanupClosed(t *testing.T) {
	dir := t.TempDir()
	store, err := NewInterventionStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan := makeTestPlan("proj-1", "plan-1", "res-1", false, []plans.PreflightIssue{
		{Code: "E1", Level: "error", Path: "x", Message: "m", Stages: nil},
	})

	engine, _ := setupTestEngine(t)
	engine.store = store

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	_, err = engine.Close(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	removed, err := store.CleanupClosed(0)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Errorf("expected 1 removed, got %d", removed)
	}

	files, _ := os.ReadDir(dir)
	jsonFiles := 0
	for _, f := range files {
		if filepath.Ext(f.Name()) == ".json" {
			jsonFiles++
		}
	}
	if jsonFiles != 0 {
		t.Errorf("expected 0 json files after cleanup, got %d", jsonFiles)
	}
}

func TestEngineBuildProposalsHasFallback(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	proposals := engine.buildProposals(intervention)
	if len(proposals) == 0 {
		t.Fatal("expected at least one fallback proposal")
	}

	for _, p := range proposals {
		if p.ID == "" {
			t.Error("proposal missing ID")
		}
		if p.Target == "" {
			t.Error("proposal missing target")
		}
		if len(p.Patch) == 0 {
			t.Error("proposal missing patch")
		}
		if !json.Valid(p.Patch) {
			t.Error("proposal patch is not valid JSON")
		}
	}
}

func TestInterventionLifecycleEdgeCases(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	_, err = engine.SelectProposalAndAdvance(intervention.ID, "nonexistent", "")
	if err == nil {
		t.Error("expected error for nonexistent proposal")
	}

	_, err = engine.Close("nonexistent-id")
	if err == nil {
		t.Error("expected error for nonexistent intervention")
	}

	_, err = engine.RetryFromFailed(intervention.ID)
	if err == nil {
		t.Error("expected error for non-failed intervention")
	}
}

func TestEngineRetryFromValidationState(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	current, err := engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	selected := current.Proposals[0]
	current, err = engine.SelectProposalAndAdvance(intervention.ID, selected.ID, "test")
	if err != nil {
		t.Fatal(err)
	}

	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	if current.State != InterventionValidation {
		t.Fatalf("expected validation state, got %s", current.State)
	}

	retried, err := engine.RetryFromFailed(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if retried.State != InterventionObservation {
		t.Errorf("expected state %s after retry from validation, got %s", InterventionObservation, retried.State)
	}
}

func TestMergeFeedbackKOmega(t *testing.T) {
	patch := json.RawMessage(`{"turbulence_model":"spalart_allmaras"}`)
	result := mergeFeedbackIntoPatch(patch, "use k-omega model")

	var parsed map[string]interface{}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["turbulence_model"] != "k_omega_sst" {
		t.Errorf("expected k_omega_sst, got %v", parsed["turbulence_model"])
	}
}

func TestMergeFeedbackTransient(t *testing.T) {
	patch := json.RawMessage(`{"cfl_number":5}`)
	result := mergeFeedbackIntoPatch(patch, "make it transient")

	var parsed map[string]interface{}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	ts, ok := parsed["time_stepping"].(map[string]interface{})
	if !ok {
		t.Fatal("expected time_stepping to be set")
	}
	if ts["scheme"] != "implicit" {
		t.Errorf("expected implicit scheme, got %v", ts["scheme"])
	}
}

func TestMergeFeedbackSteady(t *testing.T) {
	patch := json.RawMessage(`{"cfl_number":5}`)
	result := mergeFeedbackIntoPatch(patch, "use steady state")

	var parsed map[string]interface{}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	ts, ok := parsed["time_stepping"].(map[string]interface{})
	if !ok {
		t.Fatal("expected time_stepping to be set")
	}
	if ts["scheme"] != "steady" {
		t.Errorf("expected steady scheme, got %v", ts["scheme"])
	}
}

func TestMergeFeedbackUnknownProvidesHint(t *testing.T) {
	patch := json.RawMessage(`{"cfl_number":5}`)
	result := mergeFeedbackIntoPatch(patch, "change something")

	var parsed map[string]interface{}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["cfl_number"] != float64(5) {
		t.Error("unknown feedback must not corrupt the Flow360 patch")
	}
}

func TestMergeFeedbackConservativeNoExistingValues(t *testing.T) {
	patch := json.RawMessage(`{"other_param":42}`)
	result := mergeFeedbackIntoPatch(patch, "make it more conservative")

	var parsed map[string]interface{}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	if cfl, ok := parsed["cfl_number"].(float64); !ok || cfl != 5.0 {
		t.Errorf("expected new CFL 5.0 to be set when no existing value, got %v", parsed["cfl_number"])
	}
	if relax, ok := parsed["relaxation_factor"].(float64); !ok || relax != 0.7 {
		t.Errorf("expected new relaxation 0.7, got %v", parsed["relaxation_factor"])
	}
}

func TestEngineRetryFullCycleAfterValidationFail(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_INVALID_CFL", Level: "error", Path: "operating_condition.cfl_number", Message: "CFL number too high", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	current, err := engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	selected := current.Proposals[0]
	current, err = engine.SelectProposalAndAdvance(intervention.ID, selected.ID, "test")
	if err != nil {
		t.Fatal(err)
	}

	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	_, err = engine.CompleteValidation(intervention.ID, false, []string{"Still invalid"})
	if err != nil {
		t.Fatal(err)
	}

	_, err = engine.RetryFromFailed(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}

	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.State != InterventionDiagnosis {
		t.Errorf("expected state %s after retry step, got %s", InterventionDiagnosis, current.State)
	}

	current, err = engine.RunEngineStep(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.State != InterventionProposal {
		t.Errorf("expected state %s after retry second step, got %s", InterventionProposal, current.State)
	}
	if len(current.Proposals) == 0 {
		t.Error("expected new proposals after retry")
	}
}

func TestBuildPreflightProposalsUsesSchemaRecommendation(t *testing.T) {
	engine, _ := setupTestEngine(t)

	issues := []plans.PreflightIssue{
		{Code: "ERR_BOUNDARY", Level: "error", Path: "models", Message: "Missing boundary on face-123", Stages: []string{"setup"}},
	}
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, issues)
	plan.Preflight.FormSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"models":{
				"type":"entity_assignment",
				"default_model":"existing:0",
				"default_entities":["face-123","face-456"],
				"recommendation":{"reason":"Reuse the current Wall model."}
			}
		}
	}`)

	intervention, err := engine.CreateFromPreflightError(plan)
	if err != nil {
		t.Fatal(err)
	}

	proposals := buildPreflightProposals(intervention)
	if len(proposals) == 0 {
		t.Fatal("expected proposals")
	}

	pfProposal := proposals[0]
	var patchMap map[string]interface{}
	if err := json.Unmarshal(pfProposal.Patch, &patchMap); err != nil {
		t.Fatal(err)
	}
	ea, ok := patchMap["models"].(map[string]interface{})
	if !ok {
		t.Fatal("expected schema form path in patch")
	}
	entities, ok := ea["entities"].([]interface{})
	if !ok || len(entities) == 0 {
		t.Error("expected entities to be populated from the signed schema recommendation")
	}
}

func TestBuildPreflightProposalsDoesNotInventEntities(t *testing.T) {
	plan := makeTestPlan("proj-1", "plan-1", "vm-1", false, nil)
	plan.Preflight = nil

	intervention := Intervention{
		ID:   "test-id",
		Type: TypePreflightError,
	}

	proposals := buildPreflightProposals(intervention)
	if len(proposals) == 0 {
		t.Fatal("expected fallback proposals")
	}

	var patchMap map[string]interface{}
	if err := json.Unmarshal(proposals[0].Patch, &patchMap); err != nil {
		t.Fatal(err)
	}
	if len(patchMap) != 0 {
		t.Fatalf("fallback must not invent boundary entities: %#v", patchMap)
	}
}

func TestProposalFromPreflightFormRejectsIssuePathsAsEntities(t *testing.T) {
	evidence := []Evidence{{
		Type:    "preflight_issue",
		Content: json.RawMessage(`{"path":"models.0.entities","message":"missing"}`),
	}}
	if _, ok := proposalFromPreflightForm(evidence); ok {
		t.Fatal("schema issue paths are not Geometry entity IDs")
	}
}
