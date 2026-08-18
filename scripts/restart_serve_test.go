package scripts

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestRestartServeReplacesOnlyMatchingAddress(t *testing.T) {
	if _, err := exec.LookPath("pgrep"); err != nil {
		t.Skip("pgrep is unavailable")
	}
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(root, "scripts", "restart-serve.sh")
	temp := t.TempDir()
	binary := filepath.Join(temp, "vibe-flow360")
	content := "#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n"
	if err := os.WriteFile(binary, []byte(content), 0o700); err != nil {
		t.Fatal(err)
	}
	envFile := filepath.Join(temp, ".env")
	if err := os.WriteFile(envFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	other := exec.Command(binary, "serve", "--env-file", envFile, "--addr", ":19294")
	if err := other.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { stopProcess(other) })

	first := exec.Command(binary, "serve", "--env-file", envFile, "--addr", ":19293")
	if err := first.Start(); err != nil {
		t.Fatal(err)
	}
	firstDone := make(chan error, 1)
	go func() { firstDone <- first.Wait() }()
	t.Cleanup(func() {
		if processAlive(first) {
			_ = first.Process.Kill()
		}
	})
	time.Sleep(100 * time.Millisecond)

	second := exec.Command("sh", script, binary, envFile, ":19293")
	var output strings.Builder
	second.Stdout = &output
	second.Stderr = &output
	if err := second.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { stopProcess(second) })

	select {
	case <-firstDone:
	case <-time.After(5 * time.Second):
		t.Fatalf("first matching service was not stopped; output: %s", output.String())
	}
	if !processAlive(second) {
		t.Fatalf("replacement service is not running; output: %s", output.String())
	}
	if !processAlive(other) {
		t.Fatal("service on another address was stopped")
	}
}

func TestMakeServeBuildsBeforeRestart(t *testing.T) {
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(root, "Makefile"))
	if err != nil {
		t.Fatal(err)
	}
	makefile := string(content)
	if !strings.Contains(makefile, "serve: build\n") {
		t.Fatal("make serve must depend on a successful build")
	}
	if !strings.Contains(makefile, `restart-serve.sh "$(CURDIR)/vibe-flow360"`) {
		t.Fatal("make serve must start the freshly built workspace binary")
	}
}

func processAlive(command *exec.Cmd) bool {
	if command == nil || command.Process == nil {
		return false
	}
	return command.Process.Signal(syscall.Signal(0)) == nil
}

func stopProcess(command *exec.Cmd) {
	if !processAlive(command) {
		return
	}
	_ = command.Process.Signal(syscall.SIGTERM)
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case <-done:
	case <-time.After(time.Second):
		_ = command.Process.Kill()
		<-done
	}
}

func Example_makeServeOverrides() {
	fmt.Println("make serve SERVE_ADDR=127.0.0.1:9393 SERVE_ENV_FILE=/path/to/.env")
	// Output: make serve SERVE_ADDR=127.0.0.1:9393 SERVE_ENV_FILE=/path/to/.env
}
