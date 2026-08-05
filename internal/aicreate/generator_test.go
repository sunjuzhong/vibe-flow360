package aicreate

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

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
	validation, err := (&CadQueryGenerator{UVBinary: fakeUV, Timeout: time.Second}).Generate(context.Background(), geometry, outputPath)
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
	if got := classifyCADExecutionFailure("Traceback: ValueError: Boolean operation produced an empty solid"); got != GenerationGeometryFailure {
		t.Fatalf("geometry construction failure classified as %q", got)
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
