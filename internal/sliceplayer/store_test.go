package sliceplayer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStorePersistsCompletedIndexAndReusesCache(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	key := CacheKey("case-1", "results/slices.tar.gz", 42)
	job, err := store.Create("case-1", "results/slices.tar.gz", 42, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(job.ID, 55, "scanning-archive"); err != nil {
		t.Fatal(err)
	}
	index := Index{Version: IndexVersion, EntryCount: 1, Slices: []SliceSummary{{Name: "slice_wake", FrameCount: 1}}}
	playback := &Playback{Ready: true, FrameCount: 1}
	completed, err := store.Complete(job.ID, index, playback)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != JobCompleted || completed.Report == nil || !completed.Report.IndexReady {
		t.Fatalf("unexpected completed job: %#v", completed)
	}

	reloaded, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	latest, ok := reloaded.Latest("case-1")
	if !ok || latest.Status != JobCompleted {
		t.Fatalf("completed job was not restored: %#v", latest)
	}
	cached, ok := reloaded.Cached(key)
	if !ok || cached.EntryCount != 1 {
		t.Fatalf("index cache was not restored: %#v", cached)
	}
	if restored, ok := reloaded.CachedPlayback(key); !ok || restored.FrameCount != 1 {
		t.Fatalf("playback cache was not restored: %#v", restored)
	}
}

func TestLatestForResultPathKeepsArchiveJobsIndependent(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	slices, err := store.Create("case-1", "results/slices.tar.gz", 10, "slice-key")
	if err != nil {
		t.Fatal(err)
	}
	surfaces, err := store.Create("case-1", "results/surfaces.tar.gz", 20, "surface-key")
	if err != nil {
		t.Fatal(err)
	}
	if latest, ok := store.LatestForResultPath("case-1", "results/slices.tar.gz"); !ok || latest.ID != slices.ID {
		t.Fatalf("unexpected Slice job: %#v", latest)
	}
	if latest, ok := store.LatestForResultPath("case-1", "results/surfaces.tar.gz"); !ok || latest.ID != surfaces.ID {
		t.Fatalf("unexpected Surface job: %#v", latest)
	}
}

func TestStoreRecoversInterruptedJobsAndUsesStableArchiveDirectory(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	key := CacheKey("case-1", "results/slices.tar.gz", 42)
	job, err := store.Create("case-1", "results/slices.tar.gz", 42, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(job.ID, 48, "preparing-frames"); err != nil {
		t.Fatal(err)
	}
	sourceKey := SourceKey(job.CaseID, job.ResultPath, job.SourceSize)
	firstDirectory, err := store.ArchiveDirectory(sourceKey)
	if err != nil {
		t.Fatal(err)
	}

	restarted, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	recovered, ok := restarted.Get(job.ID)
	if !ok || recovered.Status != JobQueued || recovered.Stage != "recovering" || recovered.FinishedAt != nil {
		t.Fatalf("interrupted job was not made recoverable: %#v", recovered)
	}
	jobs := restarted.RecoverableJobs()
	if len(jobs) != 1 || jobs[0].ID != job.ID {
		t.Fatalf("unexpected recoverable jobs: %#v", jobs)
	}
	secondDirectory, err := restarted.ArchiveDirectory(sourceKey)
	if err != nil {
		t.Fatal(err)
	}
	if firstDirectory != secondDirectory {
		t.Fatalf("archive directory changed across restart: %q != %q", firstDirectory, secondDirectory)
	}
}

func TestNewStoreUpgradesLegacyPlaybackRangesFromLocalManifests(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	job, err := store.Create("case-1", "results/slices.tar.gz", 100, "v5:legacy")
	if err != nil {
		t.Fatal(err)
	}
	assetDir := filepath.Join(store.cacheDirectory("v5:legacy"), "assets")
	if err := os.MkdirAll(assetDir, 0o700); err != nil {
		t.Fatal(err)
	}
	manifest := `[{"resources":{"buffers":{"bounds":{"Mach":[-2,3]}}}}]`
	if err := os.WriteFile(filepath.Join(assetDir, "frame.manifest.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	playback := &Playback{Ready: true, FrameCount: 1, Frames: []PlaybackFrame{{
		Fields: []string{"Mach"}, ManifestPath: "frame.manifest.json",
	}}}
	if _, err := store.Complete(job.ID, Index{Version: 5}, playback); err != nil {
		t.Fatal(err)
	}

	restarted, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	upgraded, ok := restarted.Get(job.ID)
	if !ok || upgraded.Report.IndexVersion != IndexVersion {
		t.Fatalf("legacy report was not upgraded: %#v", upgraded.Report)
	}
	if bounds := upgraded.Report.Playback.Frames[0].FieldRanges["Mach"]; bounds != [2]float64{-2, 3} {
		t.Fatalf("legacy frame range was not restored: %#v", bounds)
	}
}
