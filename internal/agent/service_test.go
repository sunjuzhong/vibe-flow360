package agent

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCompleteRetriesTransientProviderFailureOnce(t *testing.T) {
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{}"}}]}`))
	}))
	defer provider.Close()
	service := &Service{Provider: "builtin", APIKey: "test", BaseURL: provider.URL, Model: "test", Client: provider.Client()}

	response, err := service.Complete(context.Background(), "system", "user", "")
	if err != nil || response != "{}" {
		t.Fatalf("transient provider failure did not recover: response=%q err=%v", response, err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected exactly one retry, got %d calls", calls.Load())
	}
}

func TestCompleteReturnsTypedNonRetryableProviderFailure(t *testing.T) {
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer provider.Close()
	service := &Service{Provider: "builtin", APIKey: "test", BaseURL: provider.URL, Model: "test", Client: provider.Client()}

	_, err := service.Complete(context.Background(), "system", "user", "")
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.StatusCode != http.StatusUnauthorized || providerErr.Retryable {
		t.Fatalf("expected typed non-retryable 401, got %#v (%v)", providerErr, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("non-retryable failure made %d calls", calls.Load())
	}
}

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

func TestNewServiceUsesFiveMinuteCodexBudgetByDefault(t *testing.T) {
	t.Setenv("VIBESIM_CODEX_TIMEOUT_SECONDS", "")
	service := NewService()
	if service.CodexTimeout != 5*time.Minute {
		t.Fatalf("expected five minute default Codex budget, got %s", service.CodexTimeout)
	}
}

func TestCodexProviderReturnsTypedTimeout(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "codex")
	script := `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then output="$2"; shift 2; else shift; fi
done
cat >/dev/null
sleep 1
printf '{}' > "$output"
`
	if err := os.WriteFile(binary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	service := &Service{Provider: "codex", CodexBinary: binary, CodexTimeout: 20 * time.Millisecond}
	_, err := service.Chat(context.Background(), ChatRequest{Message: "Fill the plan form"})
	if err == nil {
		t.Fatal("expected Codex timeout")
	}
	after, ok := GenerationTimeout(err)
	if !ok || after != 20*time.Millisecond {
		t.Fatalf("expected typed 20ms timeout, got %v (%v)", after, err)
	}
}

func TestCodexProviderPreservesCallerCancellation(t *testing.T) {
	binary := writeFakeCodex(t)
	service := &Service{Provider: "codex", CodexBinary: binary, CodexTimeout: time.Second}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := service.Chat(ctx, ChatRequest{Message: "Fill the plan form"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected caller cancellation, got %v", err)
	}
	if _, ok := GenerationTimeout(err); ok {
		t.Fatalf("caller cancellation was misclassified as a provider timeout: %v", err)
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

func TestCodexAppServerProviderStreamsCodexOutput(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "codex")
	script := `#!/bin/sh
if [ "$1" != "app-server" ]; then exit 2; fi
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\n' '{"id":1,"result":{"userAgent":"fake","codexHome":"/tmp","platformFamily":"unix","platformOs":"test"}}' ;;
    *'"id":2'*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-1"}}}' ;;
    *'"id":3'*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-1","status":"inProgress"}}}'
      printf '%s\n' '{"method":"item/agentMessage/delta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"msg-1","delta":"first "}}'
      printf '%s\n' '{"method":"item/agentMessage/delta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"msg-1","delta":"chunk"}}'
      printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","items":[{"type":"agentMessage","id":"msg-1","text":"first chunk"}],"status":"completed"}}}'
      exit 0
      ;;
  esac
done
`
	if err := os.WriteFile(binary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	service := &Service{Provider: "codex-app-server", CodexBinary: binary, CodexTimeout: time.Second}
	var deltas []string
	reply, err := service.ChatStream(context.Background(), ChatRequest{Message: "stream"}, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if reply != "first chunk" {
		t.Fatalf("unexpected reply: %q", reply)
	}
	if strings.Join(deltas, "") != "first chunk" {
		t.Fatalf("unexpected deltas: %#v", deltas)
	}
}

func TestCodexProviderFindsNodeBesideConfiguredBinary(t *testing.T) {
	directory := t.TempDir()
	binary := filepath.Join(directory, "codex")
	node := filepath.Join(directory, "node")
	codexScript := `#!/usr/bin/env node
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then output="$2"; shift 2; else shift; fi
done
/bin/cat >/dev/null
/usr/bin/printf '{}' > "$output"
`
	nodeShim := `#!/bin/sh
exec /bin/sh "$@"
`
	if err := os.WriteFile(binary, []byte(codexScript), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(node, []byte(nodeShim), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir())

	service := &Service{Provider: "codex", CodexBinary: binary, CodexTimeout: time.Second}
	if !service.codexReady() {
		t.Fatal("expected colocated Node runtime to make Codex ready")
	}
	response, err := service.Chat(context.Background(), ChatRequest{Message: "Analyze geometry"})
	if err != nil || response != "{}" {
		t.Fatalf("colocated Node runtime was not used: response=%q err=%v", response, err)
	}
}

func TestCodexProviderNotReadyWhenEnvShebangRuntimeIsMissing(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(binary, []byte("#!/usr/bin/env missing-codex-runtime\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir())

	service := &Service{Provider: "codex", CodexBinary: binary}
	if service.codexReady() {
		t.Fatal("Codex must not be ready without its shebang runtime")
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
