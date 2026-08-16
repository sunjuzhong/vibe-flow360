package aicreate

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewCadQueryGeneratorPreservesManagedPythonDirectory(t *testing.T) {
	pythonDirectory := filepath.Join(t.TempDir(), "managed-python")
	t.Setenv("VIBESIM_UV_PYTHON_INSTALL_DIR", pythonDirectory)

	generator := NewCadQueryGenerator()
	if generator.PythonDir != pythonDirectory {
		t.Fatalf("PythonDir = %q, want %q", generator.PythonDir, pythonDirectory)
	}
}

func TestCadQueryGeneratorUsesAbsoluteRuntimePathsForRelativeOutput(t *testing.T) {
	uvDirectory := t.TempDir()
	fakeUV := filepath.Join(uvDirectory, "uv")
	script := `#!/bin/sh
script_path=""
recipe_path=""
output_path=""
for argument in "$@"; do
  case "$argument" in
    */generate_cad.py) script_path="$argument" ;;
    */recipe.json) recipe_path="$argument" ;;
    *.step) output_path="$argument" ;;
  esac
done
test -n "$script_path" && test -f "$script_path" || exit 21
test -n "$recipe_path" && test -f "$recipe_path" || exit 22
case "$script_path:$recipe_path:$output_path" in /*:/*:/*) ;; *) exit 23 ;; esac
test "$UV_PYTHON_INSTALL_DIR" = "/managed/python" || exit 24
printf 'ISO-10303-21;\nDATA;\n#1=MANIFOLD_SOLID_BREP('"'"'shape'"'"',#2);\nENDSEC;\nEND-ISO-10303-21;\n' > "$output_path"
printf '%s' '{"solid_count":1,"face_count":6,"volume":1,"kernel":"fake"}'
`
	if err := os.WriteFile(fakeUV, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	relativeDirectory, err := os.MkdirTemp(".", ".cad-relative-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(relativeDirectory) })
	geometry := Geometry{
		Name: "cylinder", Unit: "m", Representation: "analytic-brep", Format: "step", Generator: "cadquery-dsl-v1", Result: "body",
		Operations: []Operation{{ID: "body", Op: "cylinder", Params: map[string]any{"radius": 0.5, "height": 1.0, "axis": "z"}}},
	}
	outputPath := filepath.Join(relativeDirectory, "cylinder.step")
	validation, err := (&CadQueryGenerator{UVBinary: fakeUV, PythonDir: "/managed/python", Timeout: time.Second}).Generate(context.Background(), geometry, outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if validation.SolidCount != 1 {
		t.Fatalf("unexpected validation: %#v", validation)
	}
	if _, err := os.Stat(outputPath); err != nil {
		t.Fatalf("relative STEP output was not created: %v", err)
	}
}

func TestResolveCADRuntimeFindsExecutableSiblingOutsideServicePath(t *testing.T) {
	directory := t.TempDir()
	application := filepath.Join(directory, "vibe-flow360")
	runtime := filepath.Join(directory, "uv")
	if err := os.WriteFile(runtime, []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	candidates := cadRuntimeCandidates("", application, filepath.Join(directory, "home"))
	if len(candidates) == 0 || candidates[0] != runtime {
		t.Fatalf("application-local runtime is not preferred: %#v", candidates)
	}
	previousPath := os.Getenv("PATH")
	t.Setenv("PATH", "/usr/bin:/bin")
	resolved, err := resolveCADRuntimeBinary(runtime)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != runtime {
		t.Fatalf("resolved %q, want %q (previous PATH %q)", resolved, runtime, previousPath)
	}
}

func TestResolveCADRuntimeReportsConfiguredExecutableFailure(t *testing.T) {
	_, err := resolveCADRuntimeBinary(filepath.Join(t.TempDir(), "missing-uv"))
	if err == nil || !strings.Contains(err.Error(), "VIBESIM_UV_BINARY") || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("runtime diagnostic is not actionable: %v", err)
	}
}

func TestGenerationFailureClassifiesTypedAndUnknownErrors(t *testing.T) {
	temporary := &GenerationError{Kind: GenerationTemporaryFailure, Err: context.DeadlineExceeded}
	if GenerationFailure(temporary) != GenerationTemporaryFailure {
		t.Fatal("temporary failure was not classified")
	}
	if GenerationFailure(context.Canceled) != GenerationGeometryFailure {
		t.Fatal("unknown generator errors must enter bounded Agent repair")
	}
}

func TestClassifyCADExecutionFailureSeparatesInfrastructureFromGeometry(t *testing.T) {
	if got := classifyCADExecutionFailure("python: can't open file '/tmp/generate_cad.py': No such file or directory"); got != GenerationTemporaryFailure {
		t.Fatalf("missing runtime script classified as %q", got)
	}
	if got := classifyCADExecutionFailure("ModuleNotFoundError: No module named 'cadquery'"); got != GenerationRuntimeFailure {
		t.Fatalf("missing CadQuery classified as %q", got)
	}
	if got := classifyCADExecutionFailure("current Python version (3.9.6) does not satisfy Python>=3.10; requirements are unsatisfiable"); got != GenerationRuntimeFailure {
		t.Fatalf("unsupported Python classified as %q", got)
	}
	if got := classifyCADExecutionFailure("Traceback: ValueError: Boolean operation produced an empty solid"); got != GenerationGeometryFailure {
		t.Fatalf("geometry construction failure classified as %q", got)
	}
}

func TestParseCADDiagnosticReadsStructuredKernelEvidence(t *testing.T) {
	stderr := "Traceback\nValueError: CAD_DIAGNOSTIC {\"code\":\"BOOLEAN_RESULT_EMPTY\",\"operation_id\":\"external_fluid\",\"operation\":\"cut\",\"message\":\"empty\",\"domain_relationship\":\"enclosed\",\"axis_relationships\":[\"inside\",\"cross\",\"inside\"]}\n"
	diagnostic := parseCADDiagnostic(stderr)
	if diagnostic == nil || diagnostic.Code != "BOOLEAN_RESULT_EMPTY" || diagnostic.OperationID != "external_fluid" || diagnostic.AxisRelationships[1] != "cross" {
		t.Fatalf("structured CAD diagnostic was not parsed: %#v", diagnostic)
	}
}

func TestGenerationErrorExposesStructuredDiagnosticToRepair(t *testing.T) {
	diagnostic := &CADDiagnostic{Code: "BOOLEAN_RESULT_EMPTY", OperationID: "external_fluid", Operation: "cut", Message: "empty"}
	err := &GenerationError{Kind: GenerationGeometryFailure, Err: errors.New("long traceback"), Diagnostic: diagnostic}
	if got := err.Error(); !strings.HasPrefix(got, "CAD_DIAGNOSTIC ") || !strings.Contains(got, "BOOLEAN_RESULT_EMPTY") {
		t.Fatalf("repair would receive an unstructured diagnostic: %q", got)
	}
	if !errors.Is(err, err.Err) {
		t.Fatal("structured diagnostic lost the underlying execution error")
	}
}

func TestCadQueryGeneratorRejectsIncompleteFlow360FaceCoverage(t *testing.T) {
	uvDirectory := t.TempDir()
	fakeUV := filepath.Join(uvDirectory, "uv")
	script := `#!/bin/sh
output_path=""
for argument in "$@"; do case "$argument" in *.step) output_path="$argument" ;; esac; done
printf 'ISO-10303-21;\nDATA;\n#1=MANIFOLD_SOLID_BREP('"'"'shape'"'"',#2);\nENDSEC;\nEND-ISO-10303-21;\n' > "$output_path"
printf '%s' '{"solid_count":1,"face_count":3,"volume":1,"kernel":"fake","face_coverage_checked":true,"named_face_count":2,"unnamed_face_count":1,"overlapping_face_count":0}'
`
	if err := os.WriteFile(fakeUV, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	geometry := Geometry{
		Name: "cylinder", Unit: "m", Representation: "analytic-brep", Format: "step", Generator: "cadquery-dsl-v1", Result: "body",
		Operations: []Operation{{ID: "body", Op: "cylinder", Params: map[string]any{"radius": 0.5, "height": 1.0, "axis": "z"}}},
	}
	_, err := (&CadQueryGenerator{UVBinary: fakeUV, Timeout: time.Second}).Generate(context.Background(), geometry, filepath.Join(t.TempDir(), "cylinder.step"))
	if err == nil || GenerationFailure(err) != GenerationGeometryFailure || !strings.Contains(err.Error(), "1 are unnamed") {
		t.Fatalf("incomplete Flow360 face coverage was not rejected: %v", err)
	}
}

func TestCadQueryGeneratorValidatesExistingSTEPWithAbsolutePaths(t *testing.T) {
	directory := t.TempDir()
	fakeUV := filepath.Join(directory, "uv")
	script := `#!/bin/sh
script_path=""
input_path=""
for argument in "$@"; do
  case "$argument" in
    */validate_step.py) script_path="$argument" ;;
    *.step) input_path="$argument" ;;
  esac
done
test -f "$script_path" || exit 31
test -f "$input_path" || exit 32
case "$script_path:$input_path" in /*:/*) ;; *) exit 33 ;; esac
printf '%s' '{"solid_count":2,"face_count":12,"volume":4.5,"bounds":[0,0,0,1,2,3],"kernel":"fake"}'
`
	if err := os.WriteFile(fakeUV, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	stepPath := filepath.Join(directory, "assembly.step")
	if err := os.WriteFile(stepPath, []byte("ISO-10303-21;"), 0o600); err != nil {
		t.Fatal(err)
	}
	validation, err := (&CadQueryGenerator{UVBinary: fakeUV, Timeout: time.Second}).ValidateSTEP(context.Background(), stepPath)
	if err != nil {
		t.Fatal(err)
	}
	if validation.SolidCount != 2 || validation.FaceCount != 12 || validation.Volume != 4.5 {
		t.Fatalf("unexpected validation: %#v", validation)
	}
}

func TestCadQueryGeneratorStagesSTEPPreviewInputsBesideScript(t *testing.T) {
	directory := t.TempDir()
	fakeUV := filepath.Join(directory, "uv")
	script := `#!/bin/sh
script_path=""
input_path=""
output_path=""
for argument in "$@"; do
  case "$argument" in
    */preview_step.py) script_path="$argument" ;;
    */input-1.step) input_path="$argument" ;;
    *.glb) output_path="$argument" ;;
  esac
done
test -f "$script_path" || exit 31
test -f "$input_path" || exit 32
test "${script_path%/*}" = "${input_path%/*}" || exit 33
case "$output_path" in /*) ;; *) exit 34 ;; esac
printf '%s' '{"vertices":24,"triangles":12,"bounds":[0,0,0,1,2,3]}'
`
	if err := os.WriteFile(fakeUV, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	stepPath := filepath.Join(directory, "source.step")
	if err := os.WriteFile(stepPath, []byte("ISO-10303-21;"), 0o600); err != nil {
		t.Fatal(err)
	}
	preview, err := (&CadQueryGenerator{UVBinary: fakeUV, Timeout: time.Second}).PreviewSTEP(
		context.Background(), []string{stepPath}, filepath.Join(directory, "preview.glb"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Vertices != 24 || preview.Triangles != 12 {
		t.Fatalf("unexpected preview: %#v", preview)
	}
}

func TestCadQueryGeneratorStagesSTEPThumbnailInput(t *testing.T) {
	directory := t.TempDir()
	fakeUV := filepath.Join(directory, "uv")
	script := `#!/bin/sh
script_path=""
input_path=""
output_path=""
for argument in "$@"; do
  case "$argument" in
    */thumbnail_step.py) script_path="$argument" ;;
    */input.step) input_path="$argument" ;;
    *.svg) output_path="$argument" ;;
  esac
done
test -f "$script_path" || exit 31
test -f "$input_path" || exit 32
test "${script_path%/*}" = "${input_path%/*}" || exit 33
case "$output_path" in /*) ;; *) exit 34 ;; esac
printf '<svg />' > "$output_path"
`
	if err := os.WriteFile(fakeUV, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	stepPath := filepath.Join(directory, "source.step")
	if err := os.WriteFile(stepPath, []byte("ISO-10303-21;"), 0o600); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(directory, "thumbnail.svg")
	if err := (&CadQueryGenerator{UVBinary: fakeUV, Timeout: time.Second}).ThumbnailSTEP(context.Background(), stepPath, output); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(output); err != nil || string(data) != "<svg />" {
		t.Fatalf("unexpected thumbnail: %q %v", data, err)
	}
}
