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
