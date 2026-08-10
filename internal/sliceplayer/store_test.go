package sliceplayer

import "testing"

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
