package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunCLIWithoutCommandShowsNewCommands(t *testing.T) {
	var output bytes.Buffer
	if err := runCLI(nil, strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"vibe-flow360 init", "vibe-flow360 serve", "vibe-flow360 clean"} {
		if !strings.Contains(output.String(), expected) {
			t.Fatalf("usage is missing %q:\n%s", expected, output.String())
		}
	}
}

func TestCleanCacheRemovesOnlyRegenerableTarget(t *testing.T) {
	dataDir := t.TempDir()
	oldCache := filepath.Join(dataDir, "cache", "flow360", "entry.json")
	oldPlan := filepath.Join(dataDir, "plans", "plan.json")
	if err := os.MkdirAll(filepath.Dir(oldCache), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(oldPlan), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldCache, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldPlan, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(oldCache, old, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(oldPlan, old, old); err != nil {
		t.Fatal(err)
	}

	var output bytes.Buffer
	if err := runCLI([]string{"clean", "cache", "--data-dir", dataDir, "--older-than", "1h"}, strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(oldCache); !os.IsNotExist(err) {
		t.Fatalf("expected cache file to be removed, stat error = %v", err)
	}
	if _, err := os.Stat(oldPlan); err != nil {
		t.Fatalf("expected plan file to be preserved: %v", err)
	}
	if !strings.Contains(output.String(), "Total: removed 1 files") {
		t.Fatalf("clean output missing total:\n%s", output.String())
	}
}

func TestCleanRejectsUnknownTarget(t *testing.T) {
	err := runCLI([]string{"clean", "plans"}, strings.NewReader(""), &bytes.Buffer{}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "unknown clean target") {
		t.Fatalf("clean unknown target error = %v", err)
	}
}

func TestServerURL(t *testing.T) {
	for input, want := range map[string]string{
		":9292":          "http://localhost:9292",
		"127.0.0.1:9292": "http://127.0.0.1:9292",
		"https://host":   "https://host",
	} {
		if got := serverURL(input); got != want {
			t.Errorf("serverURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestServeHelpDocumentsLifecycleAndDaemon(t *testing.T) {
	var output bytes.Buffer
	if err := runCLI([]string{"serve", "--help"}, strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"serve [start]", "serve stop", "serve restart", "--daemon", "--pid-file", "--log-file"} {
		if !strings.Contains(output.String(), expected) {
			t.Fatalf("serve help is missing %q:\n%s", expected, output.String())
		}
	}
}

func TestServeRejectsUnknownLifecycleAction(t *testing.T) {
	err := runCLI([]string{"serve", "status"}, strings.NewReader(""), &bytes.Buffer{}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "unknown serve action") {
		t.Fatalf("unknown serve action error = %v", err)
	}
}

func TestDaemonRecordRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "run", "server.pid")
	want := daemonRecord{PID: os.Getpid(), Address: ":9292", StartedAt: time.Now().UTC().Truncate(time.Second)}
	if err := writeDaemonRecord(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := readDaemonRecord(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.PID != want.PID || got.Address != want.Address || !got.StartedAt.Equal(want.StartedAt) {
		t.Fatalf("daemon record = %#v, want %#v", got, want)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatalf("PID file is not JSON: %v", err)
	}
}

func TestStopDaemonTerminatesRecordedProcess(t *testing.T) {
	command := exec.Command("sleep", "30")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	t.Cleanup(func() {
		if processAlive(command.Process.Pid) {
			_ = command.Process.Kill()
		}
		select {
		case <-done:
		default:
		}
	})
	pidFile := filepath.Join(t.TempDir(), "server.pid")
	if err := writeDaemonRecord(pidFile, daemonRecord{PID: command.Process.Pid}); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := stopDaemon(pidFile, &output); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(pidFile); !os.IsNotExist(err) {
		t.Fatalf("PID file was not removed: %v", err)
	}
	if !strings.Contains(output.String(), "stopped") {
		t.Fatalf("stop output = %q", output.String())
	}
}

func TestInitHelpExplainsAuthenticationSkipIsForAutomation(t *testing.T) {
	var output bytes.Buffer
	if err := runCLI([]string{"init", "--help"}, strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "skip-auth-check") || !strings.Contains(output.String(), "CI/image builds only") {
		t.Fatalf("init help does not constrain authentication skipping:\n%s", output.String())
	}
}
func TestVersionReportsInjectedBuildVersion(t *testing.T) {
	previous := buildVersion
	buildVersion = "25.10.3"
	t.Cleanup(func() { buildVersion = previous })

	var output bytes.Buffer
	if err := runCLI([]string{"version"}, strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(output.String()); got != "vibe-flow360 25.10.3" {
		t.Fatalf("version output = %q", got)
	}
}

func TestVersionRejectsArguments(t *testing.T) {
	err := runCLI([]string{"version", "unexpected"}, strings.NewReader(""), &bytes.Buffer{}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "does not accept") {
		t.Fatalf("version argument error = %v", err)
	}
}
