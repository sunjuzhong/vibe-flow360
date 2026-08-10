package aicreate

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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
	roundTrip, err := NewCadQueryGenerator().ValidateSTEP(context.Background(), outputPath)
	if err != nil {
		t.Fatalf("standalone STEP library validation failed: %v", err)
	}
	if roundTrip.SolidCount != validation.SolidCount || roundTrip.FaceCount != validation.FaceCount {
		t.Fatalf("standalone validation changed topology: generated=%#v validated=%#v", validation, roundTrip)
	}
}

func TestCadQueryGeneratorExportsNamedMultiBodySTEP(t *testing.T) {
	if os.Getenv("VIBESIM_CAD_INTEGRATION") != "1" {
		t.Skip("set VIBESIM_CAD_INTEGRATION=1 to run the CadQuery/OpenCascade integration test")
	}
	geometry := Geometry{
		Name: "named-multi-body", Unit: "m", Representation: "analytic-brep",
		Format: "step", Generator: "cadquery-dsl-v1",
		Operations: []Operation{
			{ID: "left", Op: "box", Params: map[string]any{"length": 1.0, "width": 1.0, "height": 1.0}},
			{ID: "right", Op: "cylinder", Params: map[string]any{"radius": 0.25, "height": 1.0, "axis": "z"}},
			{ID: "shifted", Op: "translate", Params: map[string]any{"source": "right", "vector": []any{2.0, 0.0, 0.0}}},
		},
		Results: []GeometryResult{
			{Source: "left", Name: "enclosure", Faces: []FaceLabel{
				{Name: "left", Selector: "<X"}, {Name: "right", Selector: ">X"},
				{Name: "front", Selector: "<Y"}, {Name: "back", Selector: ">Y"},
				{Name: "bottom", Selector: "<Z"}, {Name: "top", Selector: ">Z"},
			}},
			{Source: "shifted", Name: "cylinder", Faces: []FaceLabel{
				{Name: "wall", Selector: "%CYLINDER"}, {Name: "cap-min", Selector: "<Z"}, {Name: "cap-max", Selector: ">Z"},
			}},
		},
	}
	outputPath := filepath.Join(t.TempDir(), "named-multi-body.step")
	validation, err := NewCadQueryGenerator().Generate(context.Background(), geometry, outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if validation.SolidCount != 2 || len(validation.BodyNames) != 2 || len(validation.FaceNames) != 9 || validation.NamedFaceCount != validation.FaceCount {
		t.Fatalf("unexpected named topology validation: %#v", validation)
	}
	exported, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"enclosure", "cylinder", "top", "wall"} {
		if !strings.Contains(string(exported), "'"+name+"'") {
			t.Fatalf("STEP metadata is missing topology name %q", name)
		}
	}
}

func TestCadQueryGeneratorExportsLoftAndSweepSTEP(t *testing.T) {
	if os.Getenv("VIBESIM_CAD_INTEGRATION") != "1" {
		t.Skip("set VIBESIM_CAD_INTEGRATION=1 to run the CadQuery/OpenCascade integration test")
	}
	geometry := Geometry{
		Name: "advanced-profiles", Unit: "m", Representation: "analytic-brep",
		Format: "step", Generator: "cadquery-dsl-v1",
		Operations: []Operation{
			{ID: "lofted", Op: "loft", Params: map[string]any{"axis": "z", "sections": []any{
				map[string]any{"offset": 0.0, "profile_type": "spline", "profile": []any{[]any{-0.5, 0.0}, []any{-0.25, -0.2}, []any{0.25, -0.2}, []any{0.5, 0.0}, []any{0.25, 0.2}, []any{-0.25, 0.2}}},
				map[string]any{"offset": 1.0, "profile_type": "spline", "profile": []any{[]any{-0.25, 0.0}, []any{-0.125, -0.1}, []any{0.125, -0.1}, []any{0.25, 0.0}, []any{0.125, 0.1}, []any{-0.125, 0.1}}},
			}}},
			{ID: "swept", Op: "sweep", Params: map[string]any{
				"profile_plane": "YZ",
				"profile":       []any{[]any{-0.1, -0.1}, []any{0.1, -0.1}, []any{0.1, 0.1}, []any{-0.1, 0.1}},
				"path":          []any{[]any{2.0, 0.0, 0.0}, []any{2.5, 0.0, 0.0}, []any{3.0, 0.5, 0.0}},
			}},
		},
		Results: []GeometryResult{{Source: "lofted", Name: "lofted-body"}, {Source: "swept", Name: "swept-body"}},
	}
	validation, err := NewCadQueryGenerator().Generate(context.Background(), geometry, filepath.Join(t.TempDir(), "advanced.step"))
	if err != nil {
		t.Fatal(err)
	}
	if validation.SolidCount != 2 || validation.FaceCount < 8 {
		t.Fatalf("unexpected advanced topology validation: %#v", validation)
	}
}
