package server

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/sliceplayer"
)

func TestSlicePlayerRoutesKeepCaseDetailLeafReachable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	app := &Server{router: gin.New()}
	app.routes()
	wanted := map[string]bool{
		"GET /api/flow360/resources/Case/:resource_id":                                              false,
		"POST /api/flow360/resources/Case/:resource_id/slice-player/jobs":                           false,
		"GET /api/flow360/resources/Case/:resource_id/slice-player/jobs/latest":                     false,
		"GET /api/flow360/resources/Case/:resource_id/slice-player/jobs/:job_id/assets/*asset_path": false,
	}
	for _, route := range app.router.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := wanted[key]; ok {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Fatalf("route %s was not registered", route)
		}
	}
}

func TestSlicePlayerRejectsUnsupportedArchivePath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store, err := sliceplayer.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{router: gin.New(), slicePlayerJobs: store, flow360: &flow360.Client{}}
	app.router.POST("/api/flow360/resources/Case/:resource_id/slice-player/jobs", app.startSlicePlayerJob)
	request := httptest.NewRequest(http.MethodPost, "/api/flow360/resources/Case/case-1/slice-player/jobs", bytes.NewBufferString(`{"result_path":"results/volumes.tar.gz"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	app.router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestValidTimeSeriesArchivePath(t *testing.T) {
	for _, candidate := range []string{"results/slices.tar.gz", `results\slices.tar.gz`, "results/surfaces.tar.gz"} {
		if !validTimeSeriesArchivePath(candidate) {
			t.Fatalf("supported time-series archive %q was rejected", candidate)
		}
	}
	for _, candidate := range []string{"slices.tar.gz", "results/../slices.tar.gz", "results/volumes.tar.gz"} {
		if validTimeSeriesArchivePath(candidate) {
			t.Fatalf("unsafe or unrelated path %q was accepted", candidate)
		}
	}
}

func TestLatestSlicePlayerJobIgnoresStalePreviewCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store, err := sliceplayer.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create("case-1", "results/slices.tar.gz", 42, "v6:case-1:results/slices.tar.gz:42"); err != nil {
		t.Fatal(err)
	}
	app := &Server{router: gin.New(), slicePlayerJobs: store}
	app.router.GET("/api/flow360/resources/Case/:resource_id/slice-player/jobs/latest", app.latestSlicePlayerJob)
	request := httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Case/case-1/slice-player/jobs/latest?result_path=results%2Fslices.tar.gz", nil)
	recorder := httptest.NewRecorder()
	app.router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("stale preview cache was returned: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestSlicePlayerServesAssetsFromPartialPlayback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store, err := sliceplayer.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := sliceplayer.CacheKey("case-1", "results/slices.tar.gz", 42)
	job, err := store.Create("case-1", "results/slices.tar.gz", 42, key)
	if err != nil {
		t.Fatal(err)
	}
	assets, err := store.AssetDirectory(key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "frame.manifest.json"), []byte(`[]`), 0o600); err != nil {
		t.Fatal(err)
	}
	playback := sliceplayer.Playback{Ready: true, FrameCount: 1, Frames: []sliceplayer.PlaybackFrame{{ManifestPath: "frame.manifest.json"}}}
	if _, err := store.PublishPartial(job.ID, sliceplayer.Index{Version: sliceplayer.IndexVersion}, playback); err != nil {
		t.Fatal(err)
	}
	app := &Server{router: gin.New(), slicePlayerJobs: store}
	app.router.GET("/api/flow360/resources/Case/:resource_id/slice-player/jobs/:job_id/assets/*asset_path", app.slicePlayerAsset)
	request := httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Case/case-1/slice-player/jobs/"+job.ID+"/assets/frame.manifest.json", nil)
	recorder := httptest.NewRecorder()
	app.router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || recorder.Body.String() != "[]" {
		t.Fatalf("partial asset was not served: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestSlicePlayerRestoresCachedPlaybackWithTimingMetrics(t *testing.T) {
	store, err := sliceplayer.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := sliceplayer.CacheKey("case-1", "results/slices.tar.gz", 42)
	seed, err := store.Create("case-1", "results/slices.tar.gz", 42, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Complete(seed.ID, sliceplayer.Index{Version: sliceplayer.IndexVersion}, &sliceplayer.Playback{Ready: true, FrameCount: 1}); err != nil {
		t.Fatal(err)
	}
	job, err := store.Create("case-1", "results/slices.tar.gz", 42, key)
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{slicePlayerJobs: store}
	app.runSlicePlayerJob(job.ID, job.CaseID, job.ResultPath, job.CacheKey)
	restored, ok := store.Get(job.ID)
	if !ok || restored.Status != sliceplayer.JobCompleted || restored.Report == nil || restored.Report.Metrics == nil || !restored.Report.Metrics.CacheHit || restored.Report.Metrics.CacheRestoreMilliseconds < 1 {
		t.Fatalf("unexpected cached restoration: %#v", restored)
	}
}

func TestSlicePlayerCacheConfiguration(t *testing.T) {
	t.Setenv("VIBESIM_SLICE_PLAYER_CACHE_MAX_BYTES", "12345")
	t.Setenv("VIBESIM_SLICE_PLAYER_CACHE_RETENTION_HOURS", "1.5")
	if got := slicePlayerCacheMaxBytes(); got != 12345 {
		t.Fatalf("unexpected cache quota: %d", got)
	}
	if got := slicePlayerCacheRetention(); got != 90*time.Minute {
		t.Fatalf("unexpected cache retention: %s", got)
	}
}

func TestSlicePlayerDownloadCapacityErrorIsActionable(t *testing.T) {
	if err := slicePlayerDownloadCapacityError(8<<30, 9<<30); err != nil {
		t.Fatalf("sufficient disk was rejected: %v", err)
	}
	err := slicePlayerDownloadCapacityError(8<<30, 250<<20)
	if err == nil || !strings.Contains(err.Error(), "250 MB") || !strings.Contains(err.Error(), "8.5 GB") {
		t.Fatalf("unexpected capacity error: %v", err)
	}
}

func TestHumanizeSlicePlayerDownloadErrorHidesTraceback(t *testing.T) {
	err := humanizeSlicePlayerDownloadError(errors.New("Traceback (most recent call last):\n  internal details\nOSError: [Errno 28] No space left on device"))
	if strings.Contains(err.Error(), "Traceback") || !strings.Contains(err.Error(), "Insufficient local disk space") {
		t.Fatalf("download error was not humanized: %v", err)
	}
}
