package agent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultCodexTimeout = 5 * time.Minute
	maxCodexOutput      = 4 << 20
)

// GenerationTimeoutError distinguishes a provider deadline from malformed
// model output. Callers can safely offer a retry because Codex runs ephemeral,
// read-only, and cannot mutate Flow360 or the local workspace.
type GenerationTimeoutError struct {
	Provider string
	After    time.Duration
}

func (e *GenerationTimeoutError) Error() string {
	return fmt.Sprintf("%s timed out after %s", e.Provider, e.After)
}

func GenerationTimeout(err error) (time.Duration, bool) {
	var timeout *GenerationTimeoutError
	if !errors.As(err, &timeout) {
		return 0, false
	}
	return timeout.After, true
}

func codexTimeoutFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv("VIBESIM_CODEX_TIMEOUT_SECONDS"))
	if raw == "" {
		return defaultCodexTimeout
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 5 || seconds > 600 {
		return defaultCodexTimeout
	}
	return time.Duration(seconds) * time.Second
}

func (s *Service) codexReady() bool {
	_, err := exec.LookPath(s.CodexBinary)
	return err == nil
}

func (s *Service) chatWithCodex(
	ctx context.Context,
	systemPrompt string,
	userPrompt string,
	requestedModel string,
) (string, error) {
	if !s.codexReady() {
		return "", fmt.Errorf("external Codex binary %q was not found", s.CodexBinary)
	}

	runCtx, cancel := context.WithTimeout(ctx, s.CodexTimeout)
	defer cancel()

	outputDir, err := os.MkdirTemp("", "vibesim-codex-*")
	if err != nil {
		return "", fmt.Errorf("create Codex output directory: %w", err)
	}
	defer os.RemoveAll(outputDir)
	outputPath := filepath.Join(outputDir, "last-message.txt")

	args := []string{
		"exec",
		"--ephemeral",
		"--sandbox", "read-only",
		"--color", "never",
		"--skip-git-repo-check",
		"--output-last-message", outputPath,
	}
	if model := firstNonEmpty(requestedModel, s.CodexModel); model != "" {
		args = append(args, "--model", model)
	}
	if s.CodexProfile != "" {
		args = append(args, "--profile", s.CodexProfile)
	}
	if s.WorkDir != "" {
		args = append(args, "--cd", s.WorkDir)
	}
	args = append(args, "-")

	command := exec.CommandContext(runCtx, s.CodexBinary, args...)
	command.Env = codexEnvironment(os.Environ())
	command.Stdin = strings.NewReader(codexPrompt(systemPrompt, userPrompt))
	var diagnostics limitedBuffer
	command.Stdout = &diagnostics
	command.Stderr = &diagnostics

	if err := command.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return "", &GenerationTimeoutError{Provider: "external Codex", After: s.CodexTimeout}
		}
		return "", fmt.Errorf("external Codex failed: %w: %s", err, diagnostics.String())
	}

	file, err := os.Open(outputPath)
	if err != nil {
		return "", fmt.Errorf("read external Codex response: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxCodexOutput+1))
	if err != nil {
		return "", fmt.Errorf("read external Codex response: %w", err)
	}
	if len(data) > maxCodexOutput {
		return "", errors.New("external Codex response exceeded 4 MiB")
	}
	response := strings.TrimSpace(string(data))
	if response == "" {
		return "", errors.New("external Codex returned an empty response")
	}
	return response, nil
}

func codexPrompt(systemPrompt, userPrompt string) string {
	systemPrompt = strings.ToValidUTF8(systemPrompt, "\uFFFD")
	userPrompt = strings.ToValidUTF8(userPrompt, "\uFFFD")
	return fmt.Sprintf(`%s

External provider safety contract:
- Work only from the supplied Vibe Flow360 context.
- Do not edit files or execute Flow360, cloud, billing, approval, or submission actions.
- Return the requested analysis or AgentAction as your final message.

User/context request:
%s`, systemPrompt, userPrompt)
}

func codexEnvironment(environment []string) []string {
	blocked := map[string]struct{}{
		"FLOW360_APIKEY":          {},
		"VIBESIM_FLOW360_API_KEY": {},
		"VIBESIM_AI_API_KEY":      {},
	}
	result := make([]string, 0, len(environment))
	for _, entry := range environment {
		key, _, _ := strings.Cut(entry, "=")
		if _, sensitive := blocked[key]; sensitive {
			continue
		}
		result = append(result, entry)
	}
	return result
}

type limitedBuffer struct {
	buffer bytes.Buffer
}

func (b *limitedBuffer) Write(data []byte) (int, error) {
	remaining := maxCodexOutput - b.buffer.Len()
	if remaining > 0 {
		if len(data) > remaining {
			_, _ = b.buffer.Write(data[:remaining])
		} else {
			_, _ = b.buffer.Write(data)
		}
	}
	return len(data), nil
}

func (b *limitedBuffer) String() string {
	return strings.TrimSpace(b.buffer.String())
}
