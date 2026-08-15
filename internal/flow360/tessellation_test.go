package flow360

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
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

func TestNormalizeVisualizationManifestRemovesEmptyCasePlaceholders(t *testing.T) {
	manifest := json.RawMessage(`[
		{"id":"root","type":"GeometryGroup","attributions":{"members":["boundaries","slices"]}},
		{"id":"boundaries","type":"GeometryGroup","attributions":{"members":["placeholder","renderable"]}},
		{"id":"slices","type":"GeometryGroup","attributions":{"members":["wake"]}},
		{"id":"wake","type":"GeometryGroup","attributions":{"members":["placeholder"]}},
		{"id":"renderable","type":"SolidGeometry","attributions":{"faces":["kept-face","removed-face"]},"resources":{"buffers":{"type":"buffers","path":"case.bin","sections":[]}}},
		{"id":"placeholder","type":"SolidGeometry"},
		{"id":"kept-face","type":"Face","attributions":{"packedParentId":"renderable"}},
		{"id":"removed-face","type":"Face","attributions":{"packedParentId":"placeholder"}}
	]`)
	normalized, err := NormalizeVisualizationManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(normalized), "placeholder") || strings.Contains(string(normalized), "removed-face") {
		t.Fatalf("empty placeholder remained in %s", normalized)
	}
	if !strings.Contains(string(normalized), "renderable") || !strings.Contains(string(normalized), "kept-face") {
		t.Fatalf("renderable entries were removed from %s", normalized)
	}
	if strings.Contains(string(normalized), `"id":"slices"`) || strings.Contains(string(normalized), `"id":"wake"`) {
		t.Fatalf("empty geometry groups remained in %s", normalized)
	}
	if !strings.Contains(string(normalized), `"members":["boundaries"]`) {
		t.Fatalf("root group references were not pruned in %s", normalized)
	}
	if !strings.Contains(string(normalized), `"members":["renderable"]`) {
		t.Fatalf("placeholder group reference remained in %s", normalized)
	}
	if !strings.Contains(string(normalized), `"faces":["kept-face"]`) {
		t.Fatalf("solid child references were not pruned in %s", normalized)
	}
}

func TestNormalizeCaseVisualizationManifestSelectsLatestAnimationFrame(t *testing.T) {
	manifest := json.RawMessage(`[
		{"id":"root_group","type":"GeometryGroup","attributions":{"members":["slices","boundaries"]}},
		{"id":"slices","type":"GeometryGroup","attributions":{"members":["wake_animation"]}},
		{"id":"wake_animation","type":"GeometryGroup","attributions":{"members":["midspan"]}},
		{"id":"midspan","type":"SolidGeometry","resources":{"buffers":{"type":"animation","frames":[
			{"timestamp":8,"resource":{"type":"buffers","path":"midspan_8.bin","sections":[{"name":"position"}]}},
			{"timestamp":16,"resource":{"type":"buffers","path":"midspan_16.bin","sections":[{"name":"position"}]}}
		]}}},
		{"id":"boundaries","type":"GeometryGroup","attributions":{"members":["wall"]}},
		{"id":"wall","type":"SolidGeometry","resources":{"buffers":{"type":"buffers","path":"wall.bin","sections":[]}}}
	]`)

	normalized, err := NormalizeCaseVisualizationManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	text := string(normalized)
	if !strings.Contains(text, `"path":"midspan_16.bin"`) || strings.Contains(text, `"path":"midspan_8.bin"`) {
		t.Fatalf("latest animation frame was not selected: %s", normalized)
	}
	if !strings.Contains(text, `"id":"wake_animation"`) || !strings.Contains(text, `"id":"midspan"`) {
		t.Fatalf("animation hierarchy was pruned: %s", normalized)
	}
	if !strings.Contains(text, `"vibesimNormalizationVersion":2`) {
		t.Fatalf("Case normalization version was not stamped: %s", normalized)
	}
	paths, err := TessellationDefaultBinPaths(normalized)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(paths, []string{"midspan_16.bin", "wall.bin"}) {
		t.Fatalf("unexpected selected buffers: %#v", paths)
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

func TestVisualizationFailureKindClassifiesCapacityErrors(t *testing.T) {
	for _, message := range []string{
		"visualization manifest exceeds the 512 MiB remote limit",
		"visualization asset exceeds 8388608 byte limit",
		"normalized visualization manifest exceeds the size limit",
		"visualization manifest has an invalid entry count",
	} {
		if got := visualizationFailureKind(message, VisualizationMalformed); got != VisualizationTooLarge {
			t.Fatalf("message %q classified as %q", message, got)
		}
	}
	if got := visualizationFailureKind("manifest JSON is malformed", VisualizationMalformed); got != VisualizationMalformed {
		t.Fatalf("ordinary malformed error classified as %q", got)
	}
}

func TestResourceVisualizationAssetRejectsUnsafePathBeforeDownload(t *testing.T) {
	client := &Client{}
	for _, path := range []string{"../secret.bin", "/tmp/body.bin", "body.json", `nested\body.bin`} {
		if _, err := client.ResourceVisualizationAsset(context.Background(), "SurfaceMesh", "sm-1", path); err == nil {
			t.Fatalf("expected unsafe path %q to be rejected", path)
		}
	}
}

func TestSynthesizeSurfaceMeshVisualizationAssetFromBinarySTL(t *testing.T) {
	root := t.TempDir()
	manifestPath := filepath.Join(root, "manifest.json")
	stlPath := filepath.Join(root, "surfaceAll.stl")
	target := filepath.Join(root, "defaultBody.bin")
	manifest := `[{"type":"SolidGeometry","resources":{"buffers":{"type":"lod","levels":[{"path":"defaultBody.bin","sections":[` +
		`{"name":"position","dType":"float32","dimension":3,"offset":0,"length":36},` +
		`{"name":"Area","dType":"float32","dimension":1,"offset":36,"length":12},` +
		`{"name":"Aspect Ratio","dType":"float32","dimension":1,"offset":48,"length":12},` +
		`{"name":"Incircle/Circumcircle Radius Ratio Quality","dType":"float32","dimension":1,"offset":60,"length":12},` +
		`{"name":"Maximum Angle","dType":"float32","dimension":1,"offset":72,"length":12},` +
		`{"name":"Minimum Angle","dType":"float32","dimension":1,"offset":84,"length":12},` +
		`{"name":"Minimum Edge Length","dType":"float32","dimension":1,"offset":96,"length":12},` +
		`{"name":"Skewness Quality","dType":"float32","dimension":1,"offset":108,"length":12}` +
		`] }]}}}]`
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	var stl bytes.Buffer
	stl.Write(make([]byte, 80))
	if err := binary.Write(&stl, binary.LittleEndian, uint32(1)); err != nil {
		t.Fatal(err)
	}
	triangle := []float32{
		0, 0, 1,
		0, 0, 0,
		1, 0, 0,
		0.5, float32(math.Sqrt(3) / 2), 0,
	}
	if err := binary.Write(&stl, binary.LittleEndian, triangle); err != nil {
		t.Fatal(err)
	}
	if err := binary.Write(&stl, binary.LittleEndian, uint16(0)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stlPath, stl.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := synthesizeSurfaceMeshVisualizationAsset(manifestPath, stlPath, "defaultBody.bin", target); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) != 120 {
		t.Fatalf("got %d synthesized bytes, want 120", len(payload))
	}
	readFloat := func(offset int) float64 {
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[offset : offset+4])))
	}
	for _, check := range []struct {
		offset int
		want   float64
	}{
		{36, math.Sqrt(3) / 4},
		{48, 1},
		{60, 1},
		{72, 60},
		{84, 60},
		{96, 1},
		{108, 1},
	} {
		if got := readFloat(check.offset); math.Abs(got-check.want) > 1e-5 {
			t.Fatalf("field at %d = %g, want %g", check.offset, got, check.want)
		}
	}
}

func TestSynthesizeSurfaceMeshVisualizationAssetRejectsMismatchedManifest(t *testing.T) {
	root := t.TempDir()
	manifestPath := filepath.Join(root, "manifest.json")
	stlPath := filepath.Join(root, "surfaceAll.stl")
	manifest := `[{"type":"SolidGeometry","resources":{"buffers":{"path":"body.bin","sections":[` +
		`{"name":"position","dType":"float32","dimension":3,"offset":0,"length":72}` +
		`]}}}]`
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	stl := make([]byte, 84+50)
	binary.LittleEndian.PutUint32(stl[80:84], 1)
	if err := os.WriteFile(stlPath, stl, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := synthesizeSurfaceMeshVisualizationAsset(manifestPath, stlPath, "body.bin", filepath.Join(root, "body.bin")); err == nil {
		t.Fatal("expected mismatched position section to be rejected")
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
	defer visualization.Close()
	if !json.Valid(visualization.Manifest) {
		t.Fatal("downloaded manifest is invalid")
	}
	if len(visualization.Files) == 0 {
		t.Fatal("downloaded visualization has no LOD buffer files")
	}
}

func TestResourceVisualizationAssetLive(t *testing.T) {
	resourceType := os.Getenv("VIBESIM_LIVE_RESOURCE_TYPE")
	resourceID := os.Getenv("VIBESIM_LIVE_RESOURCE_ID")
	assetPath := os.Getenv("VIBESIM_LIVE_VISUALIZATION_ASSET")
	if resourceType == "" || resourceID == "" || assetPath == "" {
		t.Skip("set VIBESIM_LIVE_RESOURCE_TYPE, VIBESIM_LIVE_RESOURCE_ID, and VIBESIM_LIVE_VISUALIZATION_ASSET for a read-only Flow360 probe")
	}
	asset, err := NewClient().ResourceVisualizationAsset(
		context.Background(), resourceType, resourceID, assetPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer asset.Close()
	info, err := os.Stat(asset.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		t.Fatalf("downloaded visualization asset is invalid: mode=%s size=%d", info.Mode(), info.Size())
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
