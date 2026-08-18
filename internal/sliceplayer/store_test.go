package sliceplayer

import (
	"os"
	"path/filepath"
	"testing"
	"time"
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

func TestStorePersistsPreparationMetrics(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	job, err := store.Create("case-1", "results/slices.tar.gz", 42, "metrics-key")
	if err != nil {
		t.Fatal(err)
	}
	completed, err := store.CompleteWithMetrics(job.ID, Index{Version: IndexVersion}, &Playback{Ready: true, FrameCount: 1}, PreparationMetrics{
		DownloadMilliseconds: 10, PrepareMilliseconds: 20, CacheRestoreMilliseconds: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	metrics := completed.Report.Metrics
	if metrics == nil || metrics.DownloadMilliseconds != 10 || metrics.PrepareMilliseconds != 20 || metrics.PersistMilliseconds < 1 || metrics.TotalMilliseconds != 30+metrics.PersistMilliseconds {
		t.Fatalf("unexpected persisted metrics: %#v", metrics)
	}
}

func TestStoreCleanupEvictsLeastRecentlyUsedCacheWithinQuota(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	complete := func(caseID, key string, payloadSize int) string {
		job, createErr := store.Create(caseID, "results/slices.tar.gz", int64(payloadSize), key)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, completeErr := store.Complete(job.ID, Index{Version: IndexVersion}, &Playback{Ready: true, FrameCount: 1}); completeErr != nil {
			t.Fatal(completeErr)
		}
		directory := store.cacheDirectory(key)
		if writeErr := os.WriteFile(filepath.Join(directory, "payload.bin"), make([]byte, payloadSize), 0o600); writeErr != nil {
			t.Fatal(writeErr)
		}
		return directory
	}
	oldDirectory := complete("case-old", "old-key", 100)
	newDirectory := complete("case-new", "new-key", 100)
	oldTime := time.Now().Add(-2 * time.Hour)
	newTime := time.Now().Add(-time.Hour)
	if err := os.Chtimes(oldDirectory, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(newDirectory, newTime, newTime); err != nil {
		t.Fatal(err)
	}
	newBytes, _, err := directoryUsage(newDirectory)
	if err != nil {
		t.Fatal(err)
	}
	result, err := store.Cleanup(newBytes, 0)
	if err != nil {
		t.Fatal(err)
	}
	if result.RemovedEntries != 1 || result.RemovedBytes == 0 {
		t.Fatalf("unexpected cleanup result: %#v", result)
	}
	if _, err := os.Stat(oldDirectory); !os.IsNotExist(err) {
		t.Fatalf("least recently used cache was not removed: %v", err)
	}
	if _, err := os.Stat(newDirectory); err != nil {
		t.Fatalf("newer cache was removed: %v", err)
	}
	if _, ok := store.Latest("case-old"); ok {
		t.Fatal("evicted cache retained a completed job that can no longer play")
	}
}

func TestStoreCleanupProtectsRunningAndLeasedEntries(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	running, err := store.Create("case-running", "results/slices.tar.gz", 10, "running-key")
	if err != nil {
		t.Fatal(err)
	}
	runningCache, err := store.AssetDirectory(running.CacheKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runningCache, "active.bin"), make([]byte, 100), 0o600); err != nil {
		t.Fatal(err)
	}
	runningArchive, err := store.ArchiveDirectory(SourceKey(running.CaseID, running.ResultPath, running.SourceSize))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runningArchive, "archive.tar.gz"), make([]byte, 100), 0o600); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-48 * time.Hour)
	for _, path := range []string{filepath.Dir(runningCache), runningArchive} {
		if err := os.Chtimes(path, oldTime, oldTime); err != nil {
			t.Fatal(err)
		}
	}
	result, err := store.Cleanup(1, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if result.RemovedEntries != 0 {
		t.Fatalf("active entries were evicted: %#v", result)
	}
	if _, err := os.Stat(filepath.Dir(runningCache)); err != nil {
		t.Fatalf("running cache was removed: %v", err)
	}
	if _, err := os.Stat(runningArchive); err != nil {
		t.Fatalf("running archive was removed: %v", err)
	}
	if _, err := store.Complete(running.ID, Index{Version: IndexVersion}, &Playback{Ready: true, FrameCount: 1}); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Dir(runningCache), runningArchive} {
		if err := os.Chtimes(path, oldTime, oldTime); err != nil {
			t.Fatal(err)
		}
	}
	release, ok := store.Protect(running.ID)
	if !ok {
		t.Fatal("completed playback could not be leased")
	}
	result, err = store.Cleanup(1, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if result.RemovedEntries != 0 {
		t.Fatalf("leased entries were evicted: %#v", result)
	}
	release()
	result, err = store.Cleanup(1, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if result.RemovedEntries != 2 {
		t.Fatalf("released expired entries were not evicted: %#v", result)
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

func TestStorePersistsPartialPlaybackWithoutPromotingFinalCache(t *testing.T) {
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
	step := int64(100)
	index := Index{Version: IndexVersion, EntryCount: 2, Slices: []SliceSummary{{Name: "slice_wake", FrameCount: 1}}}
	playback := Playback{Ready: true, FrameCount: 1, Frames: []PlaybackFrame{{Slice: "slice_wake", Step: &step, ManifestPath: "frame.manifest.json"}}}
	partial, err := store.PublishPartial(job.ID, index, playback)
	if err != nil {
		t.Fatal(err)
	}
	if partial.Status != JobRunning || partial.Stage != "preparing-remaining-frames" || partial.Report == nil || !partial.Report.PartialReady || partial.Report.IndexReady {
		t.Fatalf("unexpected partial job: %#v", partial)
	}
	if _, ok := store.CachedPlayback(key); ok {
		t.Fatal("partial playback was incorrectly promoted to the final cache")
	}

	restarted, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	recovered, ok := restarted.Get(job.ID)
	if !ok || recovered.Status != JobQueued || recovered.Report == nil || !recovered.Report.PartialReady || recovered.Report.Playback.FrameCount != 1 {
		t.Fatalf("partial playback did not survive restart: %#v", recovered)
	}
	if _, err := restarted.Complete(job.ID, index, &playback); err != nil {
		t.Fatal(err)
	}
	completed, _ := restarted.Get(job.ID)
	if completed.Report.PartialReady || !completed.Report.IndexReady {
		t.Fatalf("final completion retained partial state: %#v", completed.Report)
	}
	if _, err := os.Stat(filepath.Join(restarted.cacheDirectory(key), "playback.partial.json")); !os.IsNotExist(err) {
		t.Fatalf("partial playback file was not removed: %v", err)
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
