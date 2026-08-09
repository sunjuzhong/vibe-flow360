package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
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
		"GET /api/flow360/resources/Case/:resource_id":                          false,
		"POST /api/flow360/resources/Case/:resource_id/slice-player/jobs":       false,
		"GET /api/flow360/resources/Case/:resource_id/slice-player/jobs/latest": false,
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

func TestSlicePlayerRejectsNonCanonicalArchivePath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store, err := sliceplayer.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{router: gin.New(), slicePlayerJobs: store, flow360: &flow360.Client{}}
	app.router.POST("/api/flow360/resources/Case/:resource_id/slice-player/jobs", app.startSlicePlayerJob)
	request := httptest.NewRequest(http.MethodPost, "/api/flow360/resources/Case/case-1/slice-player/jobs", bytes.NewBufferString(`{"result_path":"results/surfaces.tar.gz"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	app.router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestValidSliceArchivePath(t *testing.T) {
	if !validSliceArchivePath("results/slices.tar.gz") || !validSliceArchivePath(`results\slices.tar.gz`) {
		t.Fatal("canonical Slice archive was rejected")
	}
	for _, candidate := range []string{"slices.tar.gz", "results/../slices.tar.gz", "results/surfaces.tar.gz"} {
		if validSliceArchivePath(candidate) {
			t.Fatalf("unsafe or unrelated path %q was accepted", candidate)
		}
	}
}
