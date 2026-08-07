package flow360

import (
	"context"
	"encoding/json"
	"errors"
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

func TestProjectsTreatsWorkspaceRootAsUnfilteredListing(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$@" > %q
printf '{"records":[{"id":"prj-1"}]}'
`, argsPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	if _, err := client.Projects(context.Background(), 25, "ROOT.FLOW360"); err != nil {
		t.Fatal(err)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(args), "--folder-id") || strings.Contains(string(args), "--exclude-subfolders") {
		t.Fatalf("workspace root was sent as a folder filter: %q", args)
	}
}

func TestUnsupportedProjectTypeErrorRecognizesSDKLiteralFailure(t *testing.T) {
	err := errors.New("records.3.rootItemType: Input should be Geometry [type=literal_error]")
	if !unsupportedProjectTypeError(err) {
		t.Fatal("Flow360 rootItemType Literal failure was not recognized")
	}
	if unsupportedProjectTypeError(errors.New("network unavailable")) {
		t.Fatal("unrelated project list failure was treated as an SDK compatibility error")
	}
}

func TestCompactProjectOutputPreservesIDsOutsideFirstJSONValue(t *testing.T) {
	output := []byte("{\"id\":\"geo-one\",\"type\":\"Geometry\"}\nproject id = prj-later-in-output\n")
	compact := compactProjectOutput(output)
	if !strings.Contains(compact, "geo-one") || !strings.Contains(compact, "prj-later-in-output") {
		t.Fatalf("project creation output lost resource IDs: %q", compact)
	}
}

func TestFindProjectByNameReturnsOnlyCurrentMatchingProject(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$@" > %q
printf '%%s' '{"records":[{"id":"prj-old","name":"Cylinder study","root_item_type":"Geometry","created_at":"2026-08-05T02:00:00Z"},{"id":"prj-wrong-type","name":"Cylinder study","root_item_type":"SurfaceMesh","created_at":"2026-08-05T03:01:00Z"},{"id":"prj-new","name":"Cylinder study","root_item_type":"Geometry","created_at":"2026-08-05T03:02:00Z"}]}'
`, argsPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	raw, err := client.FindProjectByName(
		context.Background(), "folder-1", "Cylinder study", "geometry",
		time.Date(2026, 8, 5, 3, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"id":"prj-new"`) {
		t.Fatalf("unexpected reconciled Project: %s", raw)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(args)
	for _, expected := range []string{"project\nlist\n", "--folder-id\nfolder-1\n", "--exclude-subfolders\n"} {
		if !strings.Contains(got, expected) {
			t.Errorf("missing %q in command arguments: %q", expected, got)
		}
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

func TestFolderMutationsUseTypedCLICommands(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s ' "$@" >> %q
printf '\n' >> %q
printf '{"id":"folder-child","name":"Design studies"}'
`, argsPath, argsPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	ctx := context.Background()
	if _, err := client.CreateFolder(ctx, " Design studies ", "ROOT.FLOW360", []string{"cfd", " "}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.RenameFolder(ctx, "folder-child", " Aero studies "); err != nil {
		t.Fatal(err)
	}
	if _, err := client.MoveFolder(ctx, "folder-child", "folder-parent"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.DeleteFolder(ctx, "folder-child"); err != nil {
		t.Fatal(err)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(args)
	for _, expected := range []string{
		"folder create --name Design studies --parent-folder-id ROOT.FLOW360 --tag cfd",
		"folder rename folder-child --name Aero studies",
		"folder move folder-child --parent-folder-id folder-parent",
		"folder delete folder-child --yes",
	} {
		if !strings.Contains(got, expected) {
			t.Errorf("missing %q in commands:\n%s", expected, got)
		}
	}
}

func TestProjectMutationsUseTypedCLICommands(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s ' "$@" >> %q
printf '\n' >> %q
printf '{"id":"prj-123","name":"Renamed project"}'
`, argsPath, argsPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	ctx := context.Background()
	if _, err := client.RenameProject(ctx, "prj-123", " Renamed project "); err != nil {
		t.Fatal(err)
	}
	if _, err := client.DeleteProject(ctx, "prj-123"); err != nil {
		t.Fatal(err)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(args)
	for _, expected := range []string{
		"project rename prj-123 --name Renamed project",
		"project delete prj-123 --yes",
	} {
		if !strings.Contains(got, expected) {
			t.Errorf("missing %q in commands:\n%s", expected, got)
		}
	}
}

func TestDeleteProjectTreatsNotFoundAsIdempotentSuccess(t *testing.T) {
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := `#!/bin/sh
printf "Web project: Not found error: {'error': 'Item not found.', 'code': '4040000001', 'httpStatus': 'NOT_FOUND'}\n" >&2
exit 1
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	raw, err := client.DeleteProject(context.Background(), "prj-stale")
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		ID            string `json:"id"`
		Deleted       bool   `json:"deleted"`
		AlreadyAbsent bool   `json:"already_absent"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.ID != "prj-stale" || !result.Deleted || !result.AlreadyAbsent {
		t.Fatalf("unexpected idempotent delete result: %s", raw)
	}
}

func TestFlow360NotFoundErrorClassification(t *testing.T) {
	for _, message := range []string{
		"Item not found.",
		"Not found error: project missing",
		"code 4040000001",
	} {
		if !isFlow360NotFoundError(errors.New(message)) {
			t.Errorf("not-found error was not recognized: %q", message)
		}
	}
	if isFlow360NotFoundError(errors.New("permission denied")) {
		t.Fatal("permission error was misclassified as not found")
	}
}

func TestEnsureDraftCreatesOnceAndReturnsRemoteID(t *testing.T) {
	dir := t.TempDir()
	countPath := filepath.Join(dir, "count.txt")
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s ' "$@" >> %q
printf '\n' >> %q
if [ "$1 $2" = "draft list" ]; then
  if [ -f %q ]; then printf '{"records":[{"id":"draft-ai-1","type":"Draft","name":"AI Create · Cylinder"}]}'; else printf '{"records":[]}'; fi
elif [ "$1 $2" = "draft create" ]; then
  printf x > %q
  printf '{"id":"draft-ai-1","type":"Draft","name":"AI Create · Cylinder"}'
fi
`, argsPath, argsPath, countPath, countPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	first, err := client.EnsureDraft(context.Background(), "prj-1", "geo-1", "AI Create · Cylinder")
	if err != nil {
		t.Fatal(err)
	}
	second, err := client.EnsureDraft(context.Background(), "prj-1", "geo-1", "AI Create · Cylinder")
	if err != nil {
		t.Fatal(err)
	}
	if draftIDFromPayload(first) != "draft-ai-1" || draftIDFromPayload(second) != "draft-ai-1" {
		t.Fatalf("unexpected Draft results: %s / %s", first, second)
	}
	args, _ := os.ReadFile(argsPath)
	if strings.Count(string(args), "draft create") != 1 {
		t.Fatalf("EnsureDraft created more than once: %s", args)
	}
}

func TestEnsureDraftReusesProjectDefaultDraftForSameSource(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s ' "$@" >> %q
printf '\n' >> %q
if [ "$1 $2" = "draft list" ]; then
  printf '{"records":[{"id":"draft-default-1","type":"Draft","name":"Draft 1","source_item_id":"geo-1"}]}'
elif [ "$1 $2" = "draft create" ]; then
  printf '{"id":"draft-unexpected","type":"Draft"}'
fi
`, argsPath, argsPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	raw, err := client.EnsureDraft(context.Background(), "prj-1", "geo-1", "AI Create · Cylinder")
	if err != nil {
		t.Fatal(err)
	}
	if draftIDFromPayload(raw) != "draft-default-1" {
		t.Fatalf("default Draft was not reused: %s", raw)
	}
	args, _ := os.ReadFile(argsPath)
	if strings.Contains(string(args), "draft create") {
		t.Fatalf("EnsureDraft created a duplicate: %s", args)
	}
}

func TestRunExistingDraftDoesNotSendNameOrPatch(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$@" > %q
printf '{"draft":{"id":"draft-ai-1","type":"Draft"},"result":{"id":"case-1","type":"Case"}}'
`, argsPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: binaryPath, Timeout: time.Second}
	if _, err := client.RunExistingDraft(context.Background(), "draft-ai-1", "case"); err != nil {
		t.Fatal(err)
	}
	args, _ := os.ReadFile(argsPath)
	got := string(args)
	if !strings.Contains(got, "draft\nrun\ndraft-ai-1\n--up-to\ncase\n") || strings.Contains(got, "--name") || strings.Contains(got, "--patch") {
		t.Fatalf("unexpected existing Draft run arguments: %q", got)
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

func TestDraftDetailUnwrapsSimulationParamsEnvelope(t *testing.T) {
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := `#!/bin/sh
case "$*" in
  *"simulation-params get"*) printf '{"simulation_params":{"meshing":{"defaults":{"surface_edge_growth_rate":1.2}}}}' ;;
  *"state"*) printf '{"status":"draft"}' ;;
  *) printf '{"id":"draft-1","name":"Baseline"}' ;;
esac
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	detail, err := (&Client{Binary: binaryPath, Timeout: time.Second}).ResourceDetail(context.Background(), "Draft", "draft-1")
	if err != nil {
		t.Fatal(err)
	}
	var params map[string]any
	if err := json.Unmarshal(detail.SimulationParams, &params); err != nil {
		t.Fatal(err)
	}
	if _, wrapped := params["simulation_params"]; wrapped || params["meshing"] == nil {
		t.Fatalf("expected canonical SimulationParams, got %s", detail.SimulationParams)
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
