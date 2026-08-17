package bootstrap

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type recordedCall struct {
	environment []string
	name        string
	args        []string
}

type fakeRunner struct {
	calls []recordedCall
}

func (runner *fakeRunner) Run(_ context.Context, environment []string, name string, args ...string) error {
	runner.calls = append(runner.calls, recordedCall{
		environment: append([]string(nil), environment...),
		name:        name,
		args:        append([]string(nil), args...),
	})
	if len(args) >= 2 && args[0] == "tool" && args[1] == "install" {
		for _, entry := range environment {
			if binDir, found := strings.CutPrefix(entry, "UV_TOOL_BIN_DIR="); found {
				if err := os.WriteFile(filepath.Join(binDir, executableName("flow360")), []byte("#!/bin/sh\n"), 0o700); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func TestPrepareInstallsPinnedIsolatedRuntimes(t *testing.T) {
	root := t.TempDir()
	uv := filepath.Join(root, "uv")
	if err := os.WriteFile(uv, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}
	result, err := Prepare(context.Background(), Options{
		ToolsDir: root,
		UVBinary: uv,
		Flow360:  "25.10.*",
		Python:   "3.11",
	}, runner)
	if err != nil {
		t.Fatal(err)
	}
	if result.Flow360Binary != filepath.Join(root, "bin", executableName("flow360")) {
		t.Fatalf("Flow360 binary = %q", result.Flow360Binary)
	}
	if len(runner.calls) != 3 {
		t.Fatalf("calls = %#v", runner.calls)
	}
	if got, want := runner.calls[0].args, []string{"tool", "install", "--upgrade", "--python", "3.11", "flow360==25.10.*"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("install args = %#v, want %#v", got, want)
	}
	if got := strings.Join(runner.calls[1].args, " "); !strings.Contains(got, "cadquery==2.6.1") {
		t.Fatalf("CadQuery was not pinned: %s", got)
	}
	if got, want := runner.calls[2].args, []string{"version"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("verification args = %#v, want %#v", got, want)
	}
}

func TestVerifyAuthenticationUsesProfileAndEnvironmentBeforeCommand(t *testing.T) {
	runner := &fakeRunner{}
	if err := VerifyAuthentication(context.Background(), runner, "/tools/flow360", "research", "uat", "secret"); err != nil {
		t.Fatal(err)
	}
	call := runner.calls[0]
	want := []string{"--profile", "research", "--uat", "project", "list", "--limit", "1", "--format", "json"}
	if !reflect.DeepEqual(call.args, want) {
		t.Fatalf("args = %#v, want %#v", call.args, want)
	}
	if !reflect.DeepEqual(call.environment, []string{"FLOW360_APIKEY=secret"}) {
		t.Fatalf("environment = %#v", call.environment)
	}
}
