package aicreate

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCadQueryGeneratorExportsDynamicBooleanSTEP(t *testing.T) {
	if os.Getenv("VIBESIM_CAD_INTEGRATION") != "1" {
		t.Skip("set VIBESIM_CAD_INTEGRATION=1 to run the CadQuery/OpenCascade integration test")
	}
	geometry := Geometry{
		Name: "dynamic-box", Unit: "m", Representation: "analytic-brep",
		Format: "step", Generator: "cadquery-dsl-v1", Result: "result",
		Operations: []Operation{
			{ID: "outer", Op: "box", Params: map[string]any{"length": 2.0, "width": 1.0, "height": 0.5}},
			{ID: "hole", Op: "cylinder", Params: map[string]any{"radius": 0.1, "height": 2.0, "axis": "x"}},
			{ID: "shifted", Op: "translate", Params: map[string]any{"source": "hole", "vector": []any{-1.0, 0.0, 0.0}}},
			{ID: "result", Op: "cut", Params: map[string]any{"left": "outer", "right": "shifted"}},
		},
	}
	outputPath := filepath.Join(t.TempDir(), "dynamic.step")
	validation, err := NewCadQueryGenerator().Generate(context.Background(), geometry, outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if validation.SolidCount != 1 || validation.FaceCount < 7 || validation.Volume <= 0 {
		t.Fatalf("unexpected topology validation: %#v", validation)
	}
	if _, err := os.Stat(outputPath); err != nil {
		t.Fatalf("STEP output is missing: %v", err)
	}
}
