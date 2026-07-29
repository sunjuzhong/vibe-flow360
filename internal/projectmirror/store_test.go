package projectmirror

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
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
	if got.ProjectID != "prj-1" || got.ArtifactPolicy != ArtifactPolicyMetadataVisualization || got.LocalPath != projectDir {
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

func TestStoreRejectsOversizedGeometryVisualizationFile(t *testing.T) {
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
	if err := os.Truncate(target, maxGeometryVisualizationFileSize+1); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GeometryVisualizationFile("geo-1", "body.bin"); err == nil {
		t.Fatal("expected oversized visualization file to be rejected")
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
