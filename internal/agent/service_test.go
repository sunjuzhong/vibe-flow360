package agent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalPlanIncludesGeometryAndSafetyBoundary(t *testing.T) {
	result := localPlan(ChatRequest{
		Message:  "Analyze lift and drag for this wing at 45 m/s",
		Geometry: "wing.step",
	})

	for _, expected := range []string{"wing.step", "external aerodynamics", "no Flow360 task has been created or submitted"} {
		if !strings.Contains(result, expected) {
			t.Fatalf("local plan does not contain %q: %s", expected, result)
		}
	}
}

func TestLocalPlanClassifiesInternalFlow(t *testing.T) {
	result := localPlan(ChatRequest{Message: "计算这个管道的压降"})
	if !strings.Contains(result, "内流分析") || !strings.Contains(result, "尚未创建或提交任何 Flow360 任务") {
		t.Fatalf("expected internal-flow classification: %s", result)
	}
}

func TestNewServiceSelectsCodexProvider(t *testing.T) {
	binary := writeFakeCodex(t)
	t.Setenv("VIBESIM_AGENT_PROVIDER", "codex")
	t.Setenv("VIBESIM_CODEX_BINARY", binary)
	t.Setenv("VIBESIM_CODEX_MODEL", "test-codex-model")
	t.Setenv("VIBESIM_CODEX_PROFILE", "test-profile")
	t.Setenv("VIBESIM_CODEX_TIMEOUT_SECONDS", "15")

	service := NewService()
	state := service.State()
	if state.Provider != "codex" || state.Mode != "codex" || !state.Ready {
		t.Fatalf("unexpected Codex state: %#v", state)
	}
	if service.CodexModel != "test-codex-model" || service.CodexProfile != "test-profile" {
		t.Fatalf("Codex configuration was not loaded: %#v", service)
	}
	if service.CodexTimeout != 15*time.Second {
		t.Fatalf("expected 15 second timeout, got %s", service.CodexTimeout)
	}
}

func TestCodexProviderRunsEphemeralReadOnlyAndValidatesAction(t *testing.T) {
	binary := writeFakeCodex(t)
	argsFile := filepath.Join(t.TempDir(), "args.txt")
	t.Setenv("VIBESIM_FAKE_CODEX_RESPONSE", `{
  "version": "v1",
  "kind": "request-missing-input",
  "message": "Need a mesh sizing decision",
  "questions": [
    {"field": "surface_max_edge_length", "message": "Choose the maximum edge length", "urgency": "required"}
  ]
}`)
	t.Setenv("VIBESIM_FAKE_CODEX_ARGS_FILE", argsFile)

	service := &Service{
		Provider:     "codex",
		CodexBinary:  binary,
		CodexTimeout: 5 * time.Second,
		WorkDir:      t.TempDir(),
	}
	response, action, err := service.ChatWithValidation(context.Background(), ChatRequest{
		Message: "Resolve missing Surface Mesh inputs",
		Context: "Geometry geo-1 requires surface_max_edge_length",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(response, "surface_max_edge_length") {
		t.Fatalf("unexpected Codex response: %s", response)
	}
	if action == nil || action.Kind != ActionRequestMissingInput {
		t.Fatalf("expected validated missing-input action, got %#v", action)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"--ephemeral", "--sandbox", "read-only", "--output-last-message"} {
		if !strings.Contains(string(args), expected) {
			t.Fatalf("Codex invocation omitted %q: %s", expected, args)
		}
	}
}

func TestCodexEnvironmentRemovesFlow360Secrets(t *testing.T) {
	filtered := codexEnvironment([]string{
		"PATH=/bin",
		"OPENAI_API_KEY=codex-auth",
		"FLOW360_APIKEY=secret",
		"VIBESIM_FLOW360_API_KEY=secret",
		"VIBESIM_AI_API_KEY=secret",
	})
	joined := strings.Join(filtered, "\n")
	if strings.Contains(joined, "FLOW360") || strings.Contains(joined, "VIBESIM_AI_API_KEY") {
		t.Fatalf("sensitive Vibe Flow360 credentials reached Codex: %s", joined)
	}
	if !strings.Contains(joined, "OPENAI_API_KEY=codex-auth") {
		t.Fatalf("Codex authentication was unexpectedly removed: %s", joined)
	}
}

func writeFakeCodex(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "codex")
	script := `#!/bin/sh
if [ -n "$VIBESIM_FAKE_CODEX_ARGS_FILE" ]; then
  printf '%s\n' "$@" > "$VIBESIM_FAKE_CODEX_ARGS_FILE"
fi
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    output="$2"
    shift 2
  else
    shift
  fi
done
cat >/dev/null
printf '%s' "$VIBESIM_FAKE_CODEX_RESPONSE" > "$output"
`
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}
