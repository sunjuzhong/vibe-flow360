package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

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
