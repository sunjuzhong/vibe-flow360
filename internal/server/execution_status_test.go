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
		want      int
		terminal  bool
	}{
		{"submitting", plans.StatusRunning, "", "Submitting to Flow360", 15, false},
		{"submitted", plans.StatusSubmitted, "", "Accepted by Flow360", 35, false},
		{"queued", plans.StatusSubmitted, "queued", "Queued on Flow360", 38, false},
		{"running", plans.StatusSubmitted, "running", "Running on Flow360", 68, false},
		{"postprocessing", plans.StatusSubmitted, "postprocessing", "Finalizing results", 88, false},
		{"completed remote", plans.StatusSubmitted, "completed", "Completed", 100, true},
		{"failed local", plans.StatusFailed, "", "Failed", 100, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			phase, progress, terminal := executionPhase(test.status, test.remote)
			if phase != test.wantPhase || progress != test.want || terminal != test.terminal {
				t.Fatalf("got (%q, %d, %v), want (%q, %d, %v)",
					phase, progress, terminal, test.wantPhase, test.want, test.terminal)
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
}

func TestRedactExecutionLogs(t *testing.T) {
	logs := "FLOW360_APIKEY=secret-key\nAuthorization: Bearer secret-token\nmesh completed"
	got := redactExecutionLogs(logs)
	if got != "FLOW360_APIKEY=[REDACTED]\nAuthorization: Bearer [REDACTED]\nmesh completed" {
		t.Fatalf("unexpected redacted logs: %q", got)
	}
}
