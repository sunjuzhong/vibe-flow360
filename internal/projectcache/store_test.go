package projectcache

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStorePersistsJSONAcrossInstances(t *testing.T) {
	dir := t.TempDir()
	first, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	written, err := first.Put("project-info", "prj-123", json.RawMessage(`{"id":"prj-123"}`))
	if err != nil {
		t.Fatal(err)
	}

	second, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := second.Get("project-info", "prj-123")
	if err != nil {
		t.Fatal(err)
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, loaded.Data); err != nil {
		t.Fatal(err)
	}
	if !loaded.CachedAt.Equal(written.CachedAt) || compact.String() != `{"id":"prj-123"}` {
		t.Fatalf("unexpected cached entry: %#v", loaded)
	}
}

func TestStoreUsesPrivateHashedFiles(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put("resource-detail", "../Case/case-123", json.RawMessage(`{"id":"case-123"}`)); err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(filepath.Join(dir, "resource-detail"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Name() == "../Case/case-123" {
		t.Fatalf("unexpected cache files: %#v", files)
	}
	info, err := files[0].Info()
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("cache file mode: %o", info.Mode().Perm())
	}
}

func TestStoreRejectsInvalidJSON(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put("project-tree", "prj-123", json.RawMessage(`not-json`)); err == nil {
		t.Fatal("expected invalid JSON to be rejected")
	}
}
