package flow360

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
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
