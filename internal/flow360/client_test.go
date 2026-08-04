package flow360

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFirstMeaningfulLinePrefersInstalledVersion(t *testing.T) {
	output := []byte("Solver Version  Installed\nInstalled version: 25.7.6b0\n")
	if got := firstMeaningfulLine(output); got != "Installed version: 25.7.6b0" {
		t.Fatalf("unexpected version: %q", got)
	}
}

func TestResolveFlow360BinaryPrefersExplicitConfiguration(t *testing.T) {
	t.Setenv("VIBESIM_FLOW360_BINARY", "/opt/flow360/bin/flow360")
	t.Setenv("VIBESIM_FLOW360_PYTHON", "")
	if got := resolveFlow360Binary(); got != "/opt/flow360/bin/flow360" {
		t.Fatalf("got %q", got)
	}
}

func TestResolveFlow360BinaryBypassesPyenvShim(t *testing.T) {
	root := t.TempDir()
	shimDir := filepath.Join(root, "shims")
	realBinary := filepath.Join(root, "versions", "flow360", "bin", "flow360")
	if err := os.MkdirAll(shimDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(realBinary), 0o700); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(shimDir, "flow360")
	if err := os.WriteFile(shim, []byte("#!/bin/sh\nexit 1\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(realBinary, []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", shimDir)
	t.Setenv("PYENV_ROOT", root)
	t.Setenv("VIBESIM_FLOW360_BINARY", "")
	t.Setenv("VIBESIM_FLOW360_PYTHON", "")

	if got := resolveFlow360Binary(); got != realBinary {
		t.Fatalf("got %q, want %q", got, realBinary)
	}
}

func TestResolveFlow360BinaryPreservesNormalPathExecutable(t *testing.T) {
	binDir := t.TempDir()
	binary := filepath.Join(binDir, "flow360")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)
	t.Setenv("PYENV_ROOT", filepath.Join(t.TempDir(), "missing"))
	t.Setenv("VIBESIM_FLOW360_BINARY", "")
	t.Setenv("VIBESIM_FLOW360_PYTHON", "")

	if got := resolveFlow360Binary(); got != binary {
		t.Fatalf("got %q, want %q", got, binary)
	}
}

func TestCommandArgsPutGlobalOptionsBeforeSubcommand(t *testing.T) {
	client := &Client{Profile: "secondary", Environment: "uat"}
	got := client.commandArgs("project", "list")
	want := []string{"--profile", "secondary", "--uat", "project", "list"}
	if len(got) != len(want) {
		t.Fatalf("unexpected arguments: %#v", got)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("argument %d: got %q, want %q", index, got[index], want[index])
		}
	}
}

func TestCommandArgsSupportNamedEnvironment(t *testing.T) {
	client := &Client{Profile: "default", Environment: "staging"}
	got := client.commandArgs("version")
	if len(got) < 5 || got[2] != "--env" || got[3] != "staging" {
		t.Fatalf("unexpected named-environment arguments: %#v", got)
	}
}

func TestExtractJSONAllowsFlow360LogPrefix(t *testing.T) {
	output := []byte("[13:48:23] INFO: Found env variable FLOW360_APIKEY\n{\"root\":{\"id\":\"ROOT.FLOW360\"}}\n")
	raw, err := extractJSON(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "ROOT.FLOW360") {
		t.Fatalf("unexpected JSON: %s", raw)
	}
}

func TestCompactProjectOutputPreservesIDsOutsideFirstJSONValue(t *testing.T) {
	output := []byte("{\"id\":\"geo-one\",\"type\":\"Geometry\"}\nproject id = prj-later-in-output\n")
	compact := compactProjectOutput(output)
	if !strings.Contains(compact, "geo-one") || !strings.Contains(compact, "prj-later-in-output") {
		t.Fatalf("project creation output lost resource IDs: %q", compact)
	}
}

func TestResourceCommandNormalizesTypes(t *testing.T) {
	tests := map[string]string{
		"Geometry":    "geometry",
		"SurfaceMesh": "surface-mesh",
		"volume-mesh": "volume-mesh",
		"Case":        "case",
		"Draft":       "draft",
	}
	for input, expected := range tests {
		command, _, err := resourceCommand(input)
		if err != nil {
			t.Fatalf("%s: %v", input, err)
		}
		if command != expected {
			t.Fatalf("%s: got %q, want %q", input, command, expected)
		}
	}
}

func TestProjectDraftsUsesProjectScopedDraftList(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$@" > %q
printf '{"records":[{"id":"draft-1","name":"Baseline"}]}'
`, argsPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	raw, err := client.ProjectDrafts(context.Background(), "prj-1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "draft-1") {
		t.Fatalf("unexpected Draft list: %s", raw)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(args); !strings.Contains(got, "draft\nlist\n--project-id\nprj-1\n") {
		t.Fatalf("unexpected Draft list arguments: %q", got)
	}
}

func TestDraftDetailOmitsUnsupportedSummaryCall(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s ' "$@" >> %q
printf '\n' >> %q
case "$*" in
  *"simulation-params get"*) printf '{"version":"test"}' ;;
  *"state"*) printf '{"status":"draft"}' ;;
  *) printf '{"id":"draft-1","name":"Baseline","project_id":"prj-1"}' ;;
esac
`, argsPath, argsPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	detail, err := client.ResourceDetail(context.Background(), "Draft", "draft-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Errors) != 0 || detail.Type != "Draft" || len(detail.SimulationParams) == 0 {
		t.Fatalf("unexpected Draft detail: %#v", detail)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(args), "summary") {
		t.Fatalf("Draft detail called unsupported summary command: %q", args)
	}
}

func TestSetDraftSimulationParamsUsesPrivateFileAndReadsCanonicalValue(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	paramsPath := filepath.Join(dir, "params.json")
	modePath := filepath.Join(dir, "mode.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$@" > %q
if [ "$3" = "set" ]; then
  cp "$5" %q
  stat -f '%%Lp' "$5" > %q
  printf '{"status":"updated"}'
else
  printf '{"version":"canonical","meshing":{"defaults":{"target_surface_node_count":1000000}}}'
fi
`, argsPath, paramsPath, modePath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	raw, err := client.SetDraftSimulationParams(context.Background(), "draft-1", json.RawMessage(`{"version":"draft"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"version":"canonical"`) {
		t.Fatalf("unexpected canonical SimulationParams: %s", raw)
	}
	written, err := os.ReadFile(paramsPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(written) != `{"version":"draft"}` {
		t.Fatalf("unexpected SimulationParams file: %s", written)
	}
	mode, err := os.ReadFile(modePath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(mode)) != "600" {
		t.Fatalf("temporary SimulationParams file mode = %q, want 600", strings.TrimSpace(string(mode)))
	}
}

func TestResourceResultUsesCaseResultsGetAndReadsOutputFile(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$@" > %q
output=''
previous=''
for argument in "$@"; do
  if [ "$previous" = "--output" ]; then output="$argument"; fi
  previous="$argument"
done
printf 'iteration,residual\n1,0.1\n' > "$output"
`, argsPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}

	client := &Client{Binary: binaryPath, Timeout: time.Second}
	output, contentType, err := client.ResourceResult(
		context.Background(),
		"Case",
		"case-123",
		"results/nonlinear_residual_v2.csv",
	)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "text/plain; charset=utf-8" {
		t.Fatalf("unexpected content type: %q", contentType)
	}
	if string(output) != "iteration,residual\n1,0.1\n" {
		t.Fatalf("unexpected result content: %q", output)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(args)
	for _, expected := range []string{
		"case\nresults\nget\ncase-123\nresults/nonlinear_residual_v2.csv\n",
		"--output\n",
		"--overwrite\n",
	} {
		if !strings.Contains(got, expected) {
			t.Fatalf("arguments %q do not contain %q", got, expected)
		}
	}
}

func TestResourceResultRejectsNonCaseResources(t *testing.T) {
	client := &Client{Binary: "should-not-run"}
	_, _, err := client.ResourceResult(context.Background(), "Geometry", "geo-123", "result.csv")
	if err == nil || !strings.Contains(err.Error(), "only available for Case") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCollectResultPathsSupportsRecordsEnvelope(t *testing.T) {
	var payload any
	if err := json.Unmarshal([]byte(`{"records":[{"name":"residuals.csv","path":"results/residuals.csv"},{"name":"forces.csv"}]}`), &payload); err != nil {
		t.Fatal(err)
	}
	got := collectResultPaths(payload)
	if len(got) != 2 || got[0] != "results/residuals.csv" || got[1] != "forces.csv" {
		t.Fatalf("unexpected result paths: %#v", got)
	}
}

func TestListCaseResultsAllowsFlow360LogPrefix(t *testing.T) {
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := `#!/bin/sh
printf '[00:00:00] INFO: profile loaded\n'
printf '{"records":[{"path":"results/nonlinear_residual_v2.csv"},{"path":"results/total_forces_v2.csv"}]}\n'
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	paths, err := client.ListCaseResults(context.Background(), "case-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 2 || paths[0] != "results/nonlinear_residual_v2.csv" {
		t.Fatalf("unexpected paths: %#v", paths)
	}
}

func TestFindDraftByNameReturnsRemoteDraftID(t *testing.T) {
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := `#!/bin/sh
printf '{"records":[{"id":"draft-other","name":"Other"},{"id":"draft-123","name":"Recovered run","case_id":"case-456"}]}\n'
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	raw, err := client.FindDraftByName(context.Background(), "prj-1", "Recovered run")
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result["draft_id"] != "draft-123" || result["case_id"] != "case-456" {
		t.Fatalf("unexpected reconciliation result: %#v", result)
	}
}
