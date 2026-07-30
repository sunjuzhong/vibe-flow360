package flow360

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestTessellationBinPaths(t *testing.T) {
	manifest := json.RawMessage(`[
		{"type":"SolidGeometry","resources":{"buffers":{"type":"buffers","path":"body.bin"}}},
		{"type":"SolidGeometry","resources":{"buffers":{"type":"lod","levels":[
			{"path":"lod/body-0.bin"},{"path":"lod/body-1.bin"}
		]}}},
		{"type":"Face","id":"face-1"}
	]`)
	got, err := TessellationBinPaths(manifest)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"body.bin", "lod/body-0.bin", "lod/body-1.bin"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestTessellationBinPathsRejectsUnsafePaths(t *testing.T) {
	for _, path := range []string{"../secret.bin", "/tmp/body.bin", "body.glb", `folder\body.bin`} {
		manifest, _ := json.Marshal([]any{
			map[string]any{
				"type": "SolidGeometry",
				"resources": map[string]any{
					"buffers": map[string]any{"type": "buffers", "path": path},
				},
			},
		})
		if _, err := TessellationBinPaths(manifest); err == nil {
			t.Fatalf("unsafe path %q was accepted", path)
		}
	}
}

func TestTessellationDefaultBinPathsSelectsManifestDefault(t *testing.T) {
	manifest := json.RawMessage(`[
		{"type":"SolidGeometry","resources":{"buffers":{"type":"buffers","path":"surface.bin"}}},
		{"type":"SolidGeometry","resources":{"buffers":{"type":"lod","default":1,"levels":[
			{"path":"slice-lod0.bin"},{"path":"slice-lod1.bin"},{"path":"slice-lod2.bin"}
		]}}}
	]`)
	got, err := TessellationDefaultBinPaths(manifest)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"slice-lod1.bin", "surface.bin"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestTessellationDefaultBinPathsRejectsInvalidDefault(t *testing.T) {
	for _, defaultValue := range []string{"-1", "2", "0.5", `"0"`, "true"} {
		manifest := json.RawMessage(`[
			{"type":"SolidGeometry","resources":{"buffers":{"type":"lod","default":` +
			defaultValue + `,"levels":[{"path":"slice.bin"}]}}}
		]`)
		if _, err := TessellationDefaultBinPaths(manifest); err == nil {
			t.Fatalf("invalid default LOD %s was accepted", defaultValue)
		}
	}
}

func TestParseVisualizationCatalogIncludesGroupsFieldsAndBounds(t *testing.T) {
	manifest := json.RawMessage(`[
		{"id":"boundaries","type":"GeometryGroup"},
		{"id":"wall","name":"Wall","type":"Face"},
		{"id":"surface","type":"SolidGeometry","resources":{"buffers":{
			"type":"lod",
			"default":0,
			"bounds":[{"name":"Cp","minVal":-1.2,"maxVal":0.8}],
			"levels":[{"path":"surface.bin","sections":[
				{"name":"indices"},{"name":"position"},{"name":"Cp"},{"name":"yPlus"}
			]}]
		}}}
	]`)
	catalog, err := ParseVisualizationCatalog(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Objects) != 1 || catalog.Objects[0].BufferPath != "surface.bin" {
		t.Fatalf("unexpected objects: %#v", catalog.Objects)
	}
	if !reflect.DeepEqual(catalog.Fields, []string{"Cp", "yPlus"}) {
		t.Fatalf("unexpected fields: %#v", catalog.Fields)
	}
	if len(catalog.Groups) != 2 || catalog.Groups[1].Name != "Wall" {
		t.Fatalf("unexpected groups: %#v", catalog.Groups)
	}
	if !strings.Contains(string(catalog.Objects[0].Bounds), `"name":"Cp"`) {
		t.Fatalf("unexpected bounds: %s", catalog.Objects[0].Bounds)
	}
}

func TestResourceVisualizationRejectsUnsupportedTypeWithTypedError(t *testing.T) {
	client := &Client{}
	_, err := client.ResourceVisualization(context.Background(), "Unknown", "asset-1")
	if err == nil {
		t.Fatal("expected error")
	}
	var visualizationErr *VisualizationError
	if !errors.As(err, &visualizationErr) {
		t.Fatalf("expected VisualizationError, got %T", err)
	}
	if visualizationErr.Kind != VisualizationInvalid {
		t.Fatalf("got kind %q, want %q", visualizationErr.Kind, VisualizationInvalid)
	}
}

func TestResourceVisualizationLive(t *testing.T) {
	resourceType := os.Getenv("VIBESIM_LIVE_RESOURCE_TYPE")
	resourceID := os.Getenv("VIBESIM_LIVE_RESOURCE_ID")
	if resourceType == "" || resourceID == "" {
		t.Skip("set VIBESIM_LIVE_RESOURCE_TYPE and VIBESIM_LIVE_RESOURCE_ID for a read-only Flow360 probe")
	}
	visualization, err := NewClient().ResourceVisualization(
		context.Background(),
		resourceType,
		resourceID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid(visualization.Manifest) {
		t.Fatal("downloaded manifest is invalid")
	}
	if len(visualization.Bins) == 0 {
		t.Fatal("downloaded visualization has no default-LOD buffers")
	}
}

func TestFlow360PythonUsesInterpreterNextToCLI(t *testing.T) {
	binDir := t.TempDir()
	flowBinary := filepath.Join(binDir, "flow360")
	python := filepath.Join(binDir, "python")
	if err := os.WriteFile(flowBinary, []byte("#!"+python+"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(python, []byte{}, 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: flowBinary}
	got, err := client.flow360Python()
	if err != nil {
		t.Fatal(err)
	}
	if got != python {
		t.Fatalf("got %q, want %q", got, python)
	}
}
