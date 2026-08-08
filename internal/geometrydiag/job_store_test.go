package geometrydiag

import (
	"os"
	"testing"
)

func TestJobStorePersistsCompletedJobsAndCache(t *testing.T) {
	root := t.TempDir()
	store, err := NewJobStore(root)
	if err != nil {
		t.Fatal(err)
	}
	job, err := store.Create("geo-1", "cache-key", Settings{SmallSurfaceRatio: 0.2, CurvatureAngleDeg: 45})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(job.ID, 55, "analyzing-tessellation"); err != nil {
		t.Fatal(err)
	}
	report := Report{SchemaVersion: 1, GeometryID: "geo-1", Fingerprint: "fingerprint"}
	if err := store.PutCached("cache-key", report); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Complete(job.ID, report); err != nil {
		t.Fatal(err)
	}

	reopened, err := NewJobStore(root)
	if err != nil {
		t.Fatal(err)
	}
	persisted, ok := reopened.Get(job.ID)
	if !ok || persisted.Status != JobCompleted || persisted.Progress != 100 || persisted.Report == nil {
		t.Fatalf("unexpected persisted job: %#v", persisted)
	}
	cached, ok := reopened.GetCached("cache-key")
	if !ok || cached.Fingerprint != report.Fingerprint {
		t.Fatalf("unexpected persisted cache: %#v, %v", cached, ok)
	}
	latest, ok := reopened.LatestCompleted("geo-1")
	if !ok || latest.ID != job.ID || latest.Report == nil {
		t.Fatalf("latest completed job not restored: %#v", latest)
	}
}

func TestJobStoreMarksInterruptedJobsFailedAndSupportsCancel(t *testing.T) {
	root := t.TempDir()
	store, err := NewJobStore(root)
	if err != nil {
		t.Fatal(err)
	}
	interrupted, _ := store.Create("geo-1", "one", Settings{})
	cancelled, _ := store.Create("geo-1", "two", Settings{})
	if _, err := store.Update(interrupted.ID, 20, "loading-buffers"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Cancel(cancelled.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Complete(cancelled.ID, Report{}); err == nil {
		t.Fatal("expected completing a cancelled job to fail")
	}

	reopened, err := NewJobStore(root)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := reopened.Get(interrupted.ID)
	if got.Status != JobFailed || got.Stage != "interrupted" || got.Error == "" {
		t.Fatalf("unexpected interrupted job: %#v", got)
	}
	got, _ = reopened.Get(cancelled.ID)
	if got.Status != JobCancelled || !reopened.IsCancelled(cancelled.ID) {
		t.Fatalf("unexpected cancelled job: %#v", got)
	}
	if _, err := reopened.Fail("missing", os.ErrInvalid); !os.IsNotExist(err) {
		t.Fatal("expected missing job error")
	}
}
