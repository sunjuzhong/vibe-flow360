package projectcache

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
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

func TestStoreSupportsFolderAndProjectListings(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	folderData := json.RawMessage(`{"root":{"id":"root","name":"Workspace"}}`)
	if _, err := store.Put("folder-tree", "root", folderData); err != nil {
		t.Fatal(err)
	}
	entry, err := store.Get("folder-tree", "root")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Key != "root" {
		t.Fatalf("expected key 'root', got %q", entry.Key)
	}
	var data map[string]interface{}
	if err := json.Unmarshal(entry.Data, &data); err != nil {
		t.Fatal(err)
	}
	root := data["root"].(map[string]interface{})
	if root["id"] != "root" || root["name"] != "Workspace" {
		t.Fatalf("folder tree data mismatch: %#v", data)
	}

	projectListData := json.RawMessage(`{"projects":[{"id":"p1","name":"Project 1"}]}`)
	if _, err := store.Put("project-list", "all", projectListData); err != nil {
		t.Fatal(err)
	}
	entry, err = store.Get("project-list", "all")
	if err != nil {
		t.Fatal(err)
	}
	var projData map[string]interface{}
	if err := json.Unmarshal(entry.Data, &projData); err != nil {
		t.Fatal(err)
	}
	projects := projData["projects"].([]interface{})
	if len(projects) != 1 || projects[0].(map[string]interface{})["id"] != "p1" {
		t.Fatalf("project list data mismatch: %#v", projData)
	}

	folderProjectsData := json.RawMessage(`{"projects":[{"id":"p2","name":"Project 2"}]}`)
	if _, err := store.Put("folder-projects", "folder-1", folderProjectsData); err != nil {
		t.Fatal(err)
	}
	entry, err = store.Get("folder-projects", "folder-1")
	if err != nil {
		t.Fatal(err)
	}
	var fpData map[string]interface{}
	if err := json.Unmarshal(entry.Data, &fpData); err != nil {
		t.Fatal(err)
	}
	fpProjects := fpData["projects"].([]interface{})
	if len(fpProjects) != 1 || fpProjects[0].(map[string]interface{})["id"] != "p2" {
		t.Fatalf("folder projects data mismatch: %#v", fpData)
	}
}

func TestStoreRejectsUnsupportedKind(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put("unknown-kind", "key", json.RawMessage(`{}`)); err == nil {
		t.Fatal("expected unsupported kind to be rejected")
	}
	if _, err := store.Get("unknown-kind", "key"); err == nil {
		t.Fatal("expected unsupported kind to be rejected on Get")
	}
}

func TestStoreGetFresh(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Put("folder-tree", "root", json.RawMessage(`{"root":{}}`))
	if err != nil {
		t.Fatal(err)
	}

	entry, err := store.GetFresh("folder-tree", "root", 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Key != "root" {
		t.Fatal("unexpected key")
	}

	_, err = store.GetFresh("folder-tree", "root", 1*time.Nanosecond)
	if err == nil {
		t.Fatal("expected expired cache to be rejected")
	}

	_, err = store.GetFresh("folder-tree", "root", 0)
	if err != nil {
		t.Fatal(err)
	}
}

func TestStoreCleanupRemovesExpiredEntries(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Put("folder-tree", "root", json.RawMessage(`{"root":{}}`))
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Put("project-list", "all", json.RawMessage(`{"projects":[]}`))
	if err != nil {
		t.Fatal(err)
	}

	err = store.updateEntryTimestamp("folder-tree", "root", time.Now().Add(-1*time.Hour))
	if err != nil {
		t.Fatal(err)
	}

	removed, err := store.Cleanup(15 * time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("expected 1 removed entry, got %d", removed)
	}

	_, err = store.Get("folder-tree", "root")
	if err == nil {
		t.Fatal("expected expired entry to be removed")
	}

	_, err = store.Get("project-list", "all")
	if err != nil {
		t.Fatal("expected non-expired entry to still exist")
	}
}

func TestStoreCleanupPreservesFreshEntries(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Put("folder-tree", "root", json.RawMessage(`{"root":{}}`))
	if err != nil {
		t.Fatal(err)
	}

	removed, err := store.Cleanup(15 * time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Fatalf("expected 0 removed, got %d", removed)
	}

	_, err = store.Get("folder-tree", "root")
	if err != nil {
		t.Fatal("expected fresh entry to still exist")
	}
}

func TestStoreCleanupRemovesCorruptFiles(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Put("folder-tree", "root", json.RawMessage(`{"root":{}}`))
	if err != nil {
		t.Fatal(err)
	}

	corruptDir := filepath.Join(dir, "project-list")
	if err := os.MkdirAll(corruptDir, 0o700); err != nil {
		t.Fatal(err)
	}
	corruptFile := filepath.Join(corruptDir, "corrupt.json")
	if err := os.WriteFile(corruptFile, []byte("not valid json at all"), 0o600); err != nil {
		t.Fatal(err)
	}

	removed, err := store.Cleanup(0)
	if err != nil {
		t.Fatal(err)
	}
	if removed < 1 {
		t.Fatalf("expected at least 1 removed, got %d", removed)
	}
}

func TestStoreUsesSeparateNamespacesForDifferentKeys(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	store.Put("folder-projects", "folder-1", json.RawMessage(`{"projects":[{"id":"p1"}]}`))
	store.Put("folder-projects", "folder-2", json.RawMessage(`{"projects":[{"id":"p2"}]}`))

	entry1, err := store.Get("folder-projects", "folder-1")
	if err != nil {
		t.Fatal(err)
	}
	var data1 map[string]interface{}
	json.Unmarshal(entry1.Data, &data1)
	projects1 := data1["projects"].([]interface{})
	if len(projects1) != 1 || projects1[0].(map[string]interface{})["id"] != "p1" {
		t.Fatal("folder-1 data mismatch")
	}

	entry2, err := store.Get("folder-projects", "folder-2")
	if err != nil {
		t.Fatal(err)
	}
	var data2 map[string]interface{}
	json.Unmarshal(entry2.Data, &data2)
	projects2 := data2["projects"].([]interface{})
	if len(projects2) != 1 || projects2[0].(map[string]interface{})["id"] != "p2" {
		t.Fatal("folder-2 data mismatch")
	}
}

func TestStoreDirectoryPermissions(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	store.Put("folder-tree", "root", json.RawMessage(`{"root":{}}`))

	kindDir := filepath.Join(dir, "folder-tree")
	info, err := os.Stat(kindDir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("directory mode: %o, expected 0700", info.Mode().Perm())
	}
}

func (s *Store) updateEntryTimestamp(kind, key string, t time.Time) error {
	entry, err := s.Get(kind, key)
	if err != nil {
		return err
	}
	entry.CachedAt = t
	payload, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return err
	}
	target := filepath.Join(s.dir, kind, cacheFileName(key))
	return os.WriteFile(target, payload, 0o600)
}
