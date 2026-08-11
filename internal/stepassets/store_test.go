package stepassets

import (
	"strings"
	"testing"

	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
)

func TestStorePersistsImmutableSTEPVersionsAndValidation(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	asset, first, err := store.Create("Wing", "baseline", "wing.step", "m", "upload", "", "", strings.NewReader("ISO-10303-21; first"))
	if err != nil {
		t.Fatal(err)
	}
	if first.Validation.Status != StatusValidating || first.Number != 1 {
		t.Fatalf("unexpected first version: %#v", first)
	}
	_, second, err := store.AddVersion(asset.ID, "wing-v2.stp", "mm", "ai", "increase chord", first.ID, strings.NewReader("ISO-10303-21; second"))
	if err != nil {
		t.Fatal(err)
	}
	report := aicreate.GeometryValidation{SolidCount: 1, FaceCount: 6, Volume: 2.5, Kernel: "OpenCascade"}
	if _, err := store.SetValidation(asset.ID, second.ID, Validation{Status: StatusReady, Report: &report}); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	loaded, ok := restarted.Get(asset.ID)
	if !ok || len(loaded.Versions) != 2 || loaded.Versions[1].Validation.Report.Volume != 2.5 {
		t.Fatalf("persisted asset mismatch: %#v", loaded)
	}
	if loaded.Versions[1].ParentVersionID != first.ID || loaded.Versions[1].Source != "ai" || loaded.Versions[1].Unit != "mm" {
		t.Fatalf("version provenance was lost: %#v", loaded.Versions[1])
	}
}

func TestStoreRejectsEmptyAndNonSTEPFiles(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Create("Bad", "", "mesh.stl", "m", "upload", "", "", strings.NewReader("mesh")); err == nil {
		t.Fatal("non-STEP extension was accepted")
	}
	if _, _, err := store.Create("Empty", "", "empty.step", "m", "upload", "", "", strings.NewReader("")); err == nil {
		t.Fatal("empty STEP was accepted")
	}
}

func TestStorePersistsAndRecoversAIJobs(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	job, err := store.CreateAIJob(AIJobRequest{Prompt: "Create a 10 mm bracket", Name: "Bracket"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateAIJob(job.ID, "running", "generating", 55, "Generating"); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := reopened.RecoverAIJobs()
	if err != nil {
		t.Fatal(err)
	}
	if len(recovered) != 1 || recovered[0].ID != job.ID || recovered[0].Status != "recovering" {
		t.Fatalf("unexpected recovered jobs: %#v", recovered)
	}
	stored, ok := reopened.AIJob(job.ID)
	if !ok || stored.Request.Prompt != "Create a 10 mm bracket" || stored.Progress != 55 {
		t.Fatalf("unexpected persisted job: %#v", stored)
	}
}

func TestStorePersistsLocalFoldersAndAssetAssignments(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	designs, err := store.CreateFolder(RootFolderID, "Designs")
	if err != nil {
		t.Fatal(err)
	}
	archive, err := store.CreateFolder(RootFolderID, "Archive")
	if err != nil {
		t.Fatal(err)
	}
	asset, _, err := store.CreateInFolder(designs.ID, "Bracket", "", "bracket.step", "mm", "upload", "", "", strings.NewReader("ISO-10303-21; bracket"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.MoveAsset(asset.ID, archive.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RenameFolder(archive.ID, "Approved"); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	loaded, ok := reopened.Get(asset.ID)
	if !ok || loaded.FolderID != archive.ID {
		t.Fatalf("asset folder assignment was not persisted: %#v", loaded)
	}
	tree := reopened.FolderTree()
	if tree.ID != RootFolderID || len(tree.Subfolders) != 2 || tree.Subfolders[0].Name != "Approved" {
		t.Fatalf("unexpected persisted folder tree: %#v", tree)
	}
}

func TestStoreProtectsFolderHierarchyAndOnlyDeletesEmptyFolders(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	parent, _ := store.CreateFolder(RootFolderID, "Parent")
	child, _ := store.CreateFolder(parent.ID, "Child")
	if _, err := store.MoveFolder(parent.ID, child.ID); err == nil {
		t.Fatal("folder cycle was accepted")
	}
	if err := store.DeleteFolder(parent.ID); err == nil {
		t.Fatal("non-empty folder was deleted")
	}
	if err := store.DeleteFolder(child.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteFolder(parent.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteFolder(RootFolderID); err == nil {
		t.Fatal("root folder was deleted")
	}
}
