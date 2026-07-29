package projectmirror

import (
	"encoding/json"
	"os"
	"path/filepath"
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
	if got.ProjectID != "prj-1" || got.ArtifactPolicy != ArtifactPolicyMetadata || got.LocalPath != projectDir {
		t.Fatalf("unexpected manifest %#v", got)
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
