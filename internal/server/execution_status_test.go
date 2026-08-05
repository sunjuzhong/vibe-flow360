package server

import (
	"testing"

	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func TestExecutionPhase(t *testing.T) {
	tests := []struct {
		name      string
		status    string
		remote    string
		wantPhase string
		terminal  bool
	}{
		{"submitting", plans.StatusRunning, "", "Submitting to Flow360", false},
		{"submitted", plans.StatusSubmitted, "", "Accepted by Flow360", false},
		{"pending", plans.StatusSubmitted, "pending", "Pending on Flow360", false},
		{"queued", plans.StatusSubmitted, "queued", "Queued on Flow360", false},
		{"running", plans.StatusSubmitted, "running", "Running on Flow360", false},
		{"postprocessing", plans.StatusSubmitted, "postprocessing", "Finalizing results", false},
		{"completed remote", plans.StatusSubmitted, "completed", "Completed", true},
		{"failed local", plans.StatusFailed, "", "Failed", true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			phase, terminal := executionPhase(test.status, test.remote)
			if phase != test.wantPhase || terminal != test.terminal {
				t.Fatalf("got (%q, %v), want (%q, %v)",
					phase, terminal, test.wantPhase, test.terminal)
			}
		})
	}
}

func TestExecutionStateUsesKnownLifecycleKeys(t *testing.T) {
	if got := executionState(map[string]any{"phase": "running"}); got != "running" {
		t.Fatalf("got %q, want running", got)
	}
	if got := executionState(map[string]any{"message": "not a state"}); got != "" {
		t.Fatalf("got unexpected lifecycle state %q", got)
	}
	if got := executionState(map[string]any{"data": map[string]any{"status": "pending"}}); got != "pending" {
		t.Fatalf("got nested lifecycle state %q", got)
	}
}

func TestExecutionProgressOnlyUsesReportedPercent(t *testing.T) {
	if got := executionProgress(map[string]any{"status": "running"}); got != nil {
		t.Fatalf("invented progress for lifecycle-only response: %v", *got)
	}
	got := executionProgress(map[string]any{"details": map[string]any{"percent_complete": float64(42)}})
	if got == nil || *got != 42 {
		t.Fatalf("expected reported progress 42, got %v", got)
	}
}

func TestRedactExecutionLogs(t *testing.T) {
	logs := "FLOW360_APIKEY=secret-key\nAuthorization: Bearer secret-token\nmesh completed"
	got := redactExecutionLogs(logs)
	if got != "FLOW360_APIKEY=[REDACTED]\nAuthorization: Bearer [REDACTED]\nmesh completed" {
		t.Fatalf("unexpected redacted logs: %q", got)
	}
}
