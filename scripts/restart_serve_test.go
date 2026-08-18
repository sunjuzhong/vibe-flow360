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
	if _, err := exec.LookPath("lsof"); err != nil {
		t.Skip("lsof is unavailable")
	}
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(root, "scripts", "restart-serve.sh")
	temp := t.TempDir()
	binary := filepath.Join(temp, "vibe-flow360")
	buildListenerBinary(t, temp, binary)
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
	waitForListener(t, ":19293")
	waitForListener(t, ":19294")

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
	waitForListener(t, ":19293")
	if !processAlive(other) {
		t.Fatal("service on another address was stopped")
	}
}

func TestRestartServeRefusesToKillUnrelatedListener(t *testing.T) {
	if _, err := exec.LookPath("lsof"); err != nil {
		t.Skip("lsof is unavailable")
	}
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	vibeBinary := filepath.Join(temp, "vibe-flow360")
	otherBinary := filepath.Join(temp, "other-server")
	buildListenerBinary(t, temp, vibeBinary)
	if err := os.Link(vibeBinary, otherBinary); err != nil {
		t.Fatal(err)
	}

	other := exec.Command(otherBinary, "serve", "--addr", ":19295")
	if err := other.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { stopProcess(other) })
	waitForListener(t, ":19295")

	command := exec.Command("sh", filepath.Join(root, "scripts", "restart-serve.sh"), vibeBinary, filepath.Join(temp, ".env"), ":19295")
	output, err := command.CombinedOutput()
	if err == nil {
		t.Fatalf("restart unexpectedly replaced an unrelated listener: %s", output)
	}
	if !strings.Contains(string(output), "is owned by other-server") {
		t.Fatalf("unexpected error: %s", output)
	}
	if !processAlive(other) {
		t.Fatal("unrelated listener was stopped")
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

func buildListenerBinary(t *testing.T, temp, output string) {
	t.Helper()
	source := filepath.Join(temp, "listener.go")
	content := `package main

import (
	"net"
	"os"
)

func main() {
	address := ":9292"
	for i := 1; i+1 < len(os.Args); i++ {
		if os.Args[i] == "--addr" {
			address = os.Args[i+1]
		}
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		panic(err)
	}
	defer listener.Close()
	for {
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		connection.Close()
	}
}
`
	if err := os.WriteFile(source, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("go", "build", "-o", output, source)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("build listener helper: %v\n%s", err, output)
	}
}

func waitForListener(t *testing.T, address string) {
	t.Helper()
	port := strings.TrimPrefix(address, ":")
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		command := exec.Command("lsof", "-nP", "-tiTCP:"+port, "-sTCP:LISTEN")
		if err := command.Run(); err == nil {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("listener on %s did not start", address)
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
