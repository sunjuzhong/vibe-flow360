package projectmirror

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestStoreWritesInspectableProjectMirror(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := NewManifest("prj-1", "production-default")
	manifest.TotalResources = 1
	if err := store.PutManifest(manifest); err != nil {
		t.Fatal(err)
	}
	if err := store.PutProjectData("prj-1", "project-info", json.RawMessage(`{"id":"prj-1"}`)); err != nil {
		t.Fatal(err)
	}
	if err := store.PutResource("prj-1", "Case", "case-1", json.RawMessage(`{"id":"case-1","type":"Case"}`)); err != nil {
		t.Fatal(err)
	}
	detail, cachedAt, err := store.ResourceDetail("Case", "case-1")
	if err != nil {
		t.Fatal(err)
	}
	var mirrored map[string]any
	if json.Unmarshal(detail, &mirrored) != nil || mirrored["id"] != "case-1" || cachedAt.IsZero() {
		t.Fatalf("unexpected mirrored detail %s at %s", detail, cachedAt)
	}

	projectDir, err := store.ProjectDir("prj-1")
	if err != nil {
		t.Fatal(err)
	}
	for _, relative := range []string{
		"manifest.json",
		"project.json",
		filepath.Join("resources", "Case", "case-1", "detail.json"),
	} {
		info, err := os.Stat(filepath.Join(projectDir, relative))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode is %o, want 0600", relative, info.Mode().Perm())
		}
	}
	got, err := store.GetManifest("prj-1")
	if err != nil {
		t.Fatal(err)
	}
	if got.ProjectID != "prj-1" || got.ArtifactPolicy != ArtifactPolicyMetadataOnly || got.LocalPath != projectDir {
		t.Fatalf("unexpected manifest %#v", got)
	}
}

func TestStoreWritesAndReadsGeometryVisualizationAtomically(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[
		{"type":"SolidGeometry","resources":{"buffers":{"path":"nested/body.bin","type":"buffers"}}}
	]`)
	artifacts, err := store.PutGeometryVisualization(
		"prj-1",
		"geo-1",
		manifest,
		map[string][]byte{"nested/body.bin": {1, 2, 3, 4}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(artifacts) != 2 {
		t.Fatalf("got %d artifacts, want 2", len(artifacts))
	}
	gotManifest, err := store.GeometryVisualizationManifest("geo-1")
	if err != nil {
		t.Fatal(err)
	}
	var gotValue, wantValue any
	if err := json.Unmarshal(gotManifest, &gotValue); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(manifest, &wantValue); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Fatalf("manifest changed: %s", gotManifest)
	}
	if bytes.Contains(gotManifest, []byte("\n")) {
		t.Fatalf("UVF manifest was pretty-printed instead of stored compactly: %s", gotManifest)
	}
	gotBin, err := store.GeometryVisualizationFile("geo-1", "nested/body.bin")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(gotBin, []byte{1, 2, 3, 4}) {
		t.Fatalf("unexpected bin %v", gotBin)
	}
	projectDir, _ := store.ProjectDir("prj-1")
	for _, relative := range []string{
		filepath.Join("resources", "Geometry", "geo-1", "visualize", "manifest", "manifest.json"),
		filepath.Join("resources", "Geometry", "geo-1", "visualize", "manifest", "nested", "body.bin"),
	} {
		info, err := os.Stat(filepath.Join(projectDir, relative))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode is %o, want 600", relative, info.Mode().Perm())
		}
	}
	manifestInfo, err := os.Stat(filepath.Join(
		projectDir, "resources", "Geometry", "geo-1", "visualize", "manifest", "manifest.json",
	))
	if err != nil {
		t.Fatal(err)
	}
	if artifacts["visualize/manifest/manifest.json"].SizeBytes != manifestInfo.Size() {
		t.Fatalf("artifact size %d does not match disk size %d", artifacts["visualize/manifest/manifest.json"].SizeBytes, manifestInfo.Size())
	}
}

func TestStoreRejectsUnsafeGeometryVisualizationPaths(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"../body.bin", "/tmp/body.bin", `folder\body.bin`, "body.glb"} {
		if _, err := store.PutGeometryVisualization(
			"prj-1",
			"geo-1",
			json.RawMessage(`[]`),
			map[string][]byte{path: {1}},
		); err == nil {
			t.Fatalf("unsafe path %q was accepted", path)
		}
	}
	for _, path := range []string{"../manifest.json", "body.glb", "/tmp/body.bin"} {
		if _, err := store.GeometryVisualizationFile("geo-1", path); err == nil {
			t.Fatalf("unsafe read path %q was accepted", path)
		}
	}
}

func TestStoreOpensMultiGigabyteVisualizationFileWithoutReadingIt(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutGeometryVisualization(
		"prj-1",
		"geo-1",
		json.RawMessage(`[{"type":"SolidGeometry"}]`),
		map[string][]byte{"body.bin": {1}},
	); err != nil {
		t.Fatal(err)
	}
	projectDir, err := store.ProjectDir("prj-1")
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(
		projectDir, "resources", "Geometry", "geo-1", "visualize", "manifest", "body.bin",
	)
	const largeSize = int64(3 * 1024 * 1024 * 1024)
	if err := os.Truncate(target, largeSize); err != nil {
		t.Fatal(err)
	}
	file, info, err := store.OpenResourceVisualizationFile("Geometry", "geo-1", "body.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if info.Size() != largeSize {
		t.Fatalf("size = %d, want %d", info.Size(), largeSize)
	}
}

func TestStoreKeepsPreviousGeometryVisualizationOnInvalidReplacement(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutGeometryVisualization(
		"prj-1",
		"geo-1",
		json.RawMessage(`[{"version":1}]`),
		map[string][]byte{"body.bin": {1}},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutGeometryVisualization(
		"prj-1",
		"geo-1",
		json.RawMessage(`[{"version":2}]`),
		map[string][]byte{"../body.bin": {2}},
	); err == nil {
		t.Fatal("expected unsafe replacement to fail")
	}
	got, err := store.GeometryVisualizationFile("geo-1", "body.bin")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, []byte{1}) {
		t.Fatalf("previous visualization was overwritten: %v", got)
	}
}

func TestStoreRejectsTraversalAndInvalidJSON(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.PutProjectData("../escape", "project-info", json.RawMessage(`{}`)); err == nil {
		t.Fatal("expected project traversal rejection")
	}
	if err := store.PutResource("prj-1", "Unknown", "resource-1", json.RawMessage(`{}`)); err == nil {
		t.Fatal("expected resource type rejection")
	}
	if err := store.PutResource("prj-1", "Case", "case-1", json.RawMessage(`invalid`)); err == nil {
		t.Fatal("expected invalid JSON rejection")
	}
}

func TestStorePutResourceVisualizationSupportsAllResourceTypes(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[{"type":"SolidGeometry","resources":{"buffers":{"type":"buffers","path":"mesh.bin"}}}]`)
	bins := map[string][]byte{"mesh.bin": {10, 20, 30}}

	for _, resourceType := range []string{"Geometry", "SurfaceMesh", "VolumeMesh", "Case"} {
		resourceID := "res-" + strings.ToLower(resourceType)
		artifacts, err := store.PutResourceVisualization("prj-1", resourceType, resourceID, manifest, bins, 0)
		if err != nil {
			t.Fatalf("PutResourceVisualization(%s) failed: %v", resourceType, err)
		}
		if len(artifacts) != 2 {
			t.Fatalf("%s: got %d artifacts, want 2", resourceType, len(artifacts))
		}
		// Verify checksum is populated
		for key, artifact := range artifacts {
			if artifact.Checksum == "" {
				t.Fatalf("%s: artifact %q has no checksum", resourceType, key)
			}
			if artifact.SyncStatus == "" {
				t.Fatalf("%s: artifact %q has no sync_status", resourceType, key)
			}
		}
	}

	// Verify manifest can be read back for each type
	for _, resourceType := range []string{"Geometry", "SurfaceMesh", "VolumeMesh", "Case"} {
		resourceID := "res-" + strings.ToLower(resourceType)
		got, err := store.ResourceVisualizationManifest(resourceType, resourceID)
		if err != nil {
			t.Fatalf("ResourceVisualizationManifest(%s) failed: %v", resourceType, err)
		}
		var gotValue, wantValue any
		if err := json.Unmarshal(got, &gotValue); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(manifest, &wantValue); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(gotValue, wantValue) {
			t.Fatalf("%s: manifest changed", resourceType)
		}
	}

	// Verify bin can be read back for each type
	for _, resourceType := range []string{"Geometry", "SurfaceMesh", "VolumeMesh", "Case"} {
		resourceID := "res-" + strings.ToLower(resourceType)
		got, err := store.ResourceVisualizationFile(resourceType, resourceID, "mesh.bin")
		if err != nil {
			t.Fatalf("ResourceVisualizationFile(%s) failed: %v", resourceType, err)
		}
		if !bytes.Equal(got, []byte{10, 20, 30}) {
			t.Fatalf("%s: unexpected bin %v", resourceType, got)
		}
	}
}

func TestStoreResourceVisualizationRejectsUnsupportedType(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutResourceVisualization("prj-1", "Unknown", "res-1", json.RawMessage(`[]`), nil, 0); err == nil {
		t.Fatal("expected unsupported resource type rejection")
	}
	if _, err := store.ResourceVisualizationManifest("Unknown", "res-1"); err == nil {
		t.Fatal("expected unsupported resource type rejection on read")
	}
	if _, err := store.ResourceVisualizationFile("Unknown", "res-1", "manifest.json"); err == nil {
		t.Fatal("expected unsupported resource type rejection on file read")
	}
}

func TestStoreResourceVisualizationChecksumIsDeterministic(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[{"type":"SolidGeometry","resources":{"buffers":{"type":"buffers","path":"body.bin"}}}]`)
	bins := map[string][]byte{"body.bin": {1, 2, 3, 4}}
	first, err := store.PutResourceVisualization("prj-1", "SurfaceMesh", "sm-1", manifest, bins, 0)
	if err != nil {
		t.Fatal(err)
	}
	// Write again with same content
	second, err := store.PutResourceVisualization("prj-1", "SurfaceMesh", "sm-1", manifest, bins, 0)
	if err != nil {
		t.Fatal(err)
	}
	for key := range first {
		if first[key].Checksum != second[key].Checksum {
			t.Fatalf("checksum mismatch for %q: %s vs %s", key, first[key].Checksum, second[key].Checksum)
		}
	}
}

func TestStorePutResourceVisualizationFilesCopiesDiskBackedBuffers(t *testing.T) {
	store, err := New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "large.bin")
	if err := os.WriteFile(source, []byte{1, 2, 3, 4, 5}, 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[{"type":"SolidGeometry","resources":{"buffers":{"type":"buffers","path":"large.bin"}}}]`)
	if _, err := store.PutResourceVisualizationFiles(
		"prj-1", "SurfaceMesh", "sm-1", manifest, map[string]string{"large.bin": source}, 0,
	); err != nil {
		t.Fatal(err)
	}
	file, info, err := store.OpenResourceVisualizationFile("SurfaceMesh", "sm-1", "large.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if info.Size() != 5 {
		t.Fatalf("copied size = %d, want 5", info.Size())
	}
}
