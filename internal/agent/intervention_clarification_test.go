package agent

import (
	"strings"
	"testing"
)

func TestInterventionClarificationRoundTrip(t *testing.T) {
	intervention, err := NewIntervention(InterventionInput{ProjectID: "project-1", Type: TypeSolverFailure, Reason: "diverged"})
	if err != nil {
		t.Fatal(err)
	}
	if err := intervention.RunDiagnosis(Diagnosis{RootCause: "unknown inlet velocity"}); err != nil {
		t.Fatal(err)
	}
	questions := []Question{{
		Field: "operating_condition.velocity_magnitude", Message: "Confirm the inlet velocity",
		Urgency: "required", Type: "number", Unit: "m/s",
	}}
	if err := intervention.RequestClarification("More information is required", questions); err != nil {
		t.Fatal(err)
	}
	if intervention.State != InterventionMissingInput || len(intervention.PendingQuestions) != 1 {
		t.Fatalf("expected a persisted missing-input state, got %#v", intervention)
	}
	if err := intervention.SubmitClarification(map[string]any{"operating_condition.velocity_magnitude": 40.0}); err != nil {
		t.Fatal(err)
	}
	if intervention.State != InterventionDiagnosis || len(intervention.PendingQuestions) != 0 {
		t.Fatalf("expected diagnosis to resume, got state=%s questions=%d", intervention.State, len(intervention.PendingQuestions))
	}
	if len(intervention.ClarificationHistory) != 1 || !strings.Contains(intervention.ClarificationHistory[0].Summary, "40 m/s") {
		t.Fatalf("expected answer history, got %#v", intervention.ClarificationHistory)
	}
}

func TestInterventionClarificationRequiresAnswers(t *testing.T) {
	intervention := Intervention{State: InterventionMissingInput, PendingQuestions: []Question{{
		Field: "cad", Message: "Choose CAD geometry", Urgency: "required",
	}}}
	if err := intervention.SubmitClarification(map[string]any{"cad": "  "}); err == nil {
		t.Fatal("expected a missing required answer error")
	}
	if intervention.State != InterventionMissingInput || len(intervention.ClarificationHistory) != 0 {
		t.Fatal("invalid answers must not advance or enter history")
	}
}
