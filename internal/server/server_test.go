package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sjzsdu/vibesim/internal/flow360"
	"github.com/sjzsdu/vibesim/internal/projectcache"
)

func TestCacheNamespaceUsesEnvironmentAndProfile(t *testing.T) {
	tests := map[string]struct {
		environment string
		profile     string
		want        string
	}{
		"defaults": {"", "", "production-default"},
		"named":    {"UAT", "Team Profile", "uat-team-profile"},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			if got := cacheNamespace(test.environment, test.profile); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

func TestResourceDetailPartialFailureFallsBackToCompleteSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const cacheKey = "SurfaceMesh/sm-test"
	snapshot := json.RawMessage(`{"id":"sm-test","type":"SurfaceMesh","info":{"status":"completed"}}`)
	if _, err := cache.Put("resource-detail", cacheKey, snapshot); err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: time.Second},
		cache:   cache,
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/SurfaceMesh/sm-test", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "SurfaceMesh"},
		{Key: "resource_id", Value: "sm-test"},
	}

	app.flow360ResourceDetail(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
	var got map[string]any
	var want map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(snapshot, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got body %v, want %v", got, want)
	}
}
