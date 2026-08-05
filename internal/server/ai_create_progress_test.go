package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAICreateProgressLifecycleUsesBackendCheckpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	app := &Server{}
	requestID := "aip-progress-test-1234"
	if !app.startAICreateProgress(requestID) {
		t.Fatal("expected a valid progress request ID")
	}
	app.updateAICreateProgress(requestID, 2, "Flow360 is processing the Project root Geometry.")
	app.bindAICreateProgressResources(requestID, "prj-12345678", "geo-12345678")

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "request_id", Value: requestID}}
	app.aiCreateProgressStatus(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	var progress aiCreateProgress
	if err := json.Unmarshal(recorder.Body.Bytes(), &progress); err != nil {
		t.Fatal(err)
	}
	if progress.Status != "running" || progress.Stage != 2 || progress.ProjectID != "prj-12345678" || progress.ResourceID != "geo-12345678" {
		t.Fatalf("unexpected live progress: %#v", progress)
	}
	if progress.Detail != "Flow360 is processing the Project root Geometry." {
		t.Fatalf("unexpected checkpoint detail: %q", progress.Detail)
	}

	app.finishAICreateProgress(requestID, "failed", "Draft setup failed.", "", "")
	progress = app.aiCreateProgress[requestID]
	if progress.ProjectID != "prj-12345678" || progress.ResourceID != "geo-12345678" {
		t.Fatalf("terminal updates must preserve already discovered Flow360 IDs: %#v", progress)
	}
	if progress.Stage != 2 || progress.Status != "failed" {
		t.Fatalf("a failed request must remain at its real checkpoint: %#v", progress)
	}
}

func TestAICreateProgressRejectsUnsafeIDs(t *testing.T) {
	app := &Server{}
	for _, requestID := range []string{"", "short", "aip-../../secret", "aip-has spaces-12345"} {
		if app.startAICreateProgress(requestID) {
			t.Fatalf("expected request ID %q to be rejected", requestID)
		}
	}
}

func TestAICreateGeometryStateDetailUsesFlow360Payload(t *testing.T) {
	got := aiCreateGeometryStateDetail(json.RawMessage(`{"data":{"status":"processing","progress_percent":42}}`))
	if got != "Flow360 Geometry state: processing (42%); waiting for canonical SimulationParams." {
		t.Fatalf("unexpected Flow360 state detail: %q", got)
	}
	if got := aiCreateGeometryStateDetail(json.RawMessage(`{}`)); got != "" {
		t.Fatalf("empty Flow360 state must not synthesize progress: %q", got)
	}
}
