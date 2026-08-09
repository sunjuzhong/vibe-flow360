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
	completed, err := store.Complete(job.ID, index)
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
}
