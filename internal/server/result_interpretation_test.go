package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
)

func TestInterpretResultUsesBoundedWholeTableSummary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var providerBody string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		providerBody = string(data)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"## Overview\nResiduals decrease."}}]}`))
	}))
	defer provider.Close()
	app := &Server{agent: &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: provider.URL, Model: "test", Client: provider.Client()}}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/interpret-result", strings.NewReader(`{
	  "path":"results/nonlinear_residual_v2.csv","language":"zh-CN","total_rows":4000,"delimiter":"comma",
	  "columns":[
	    {"field":"physical_step","kind":"numeric","count":4000,"missing":0,"unique":4,"minimum":1,"maximum":4,"mean":2.5},
	    {"field":"pseudo_step","kind":"numeric","count":4000,"missing":0,"unique":1000,"minimum":1,"maximum":1000,"mean":500.5},
	    {"field":"0_cont","kind":"numeric","count":4000,"missing":0,"unique":4000,"minimum":1e-8,"maximum":1e-2,"mean":1e-4},
	    {"field":"1_momx","kind":"numeric","count":4000,"missing":0,"unique":4000,"minimum":1e-8,"maximum":1e-2,"mean":1e-4}
	  ],
	  "sample_rows":[{"physical_step":"1","pseudo_step":"1","0_cont":"0.01","1_momx":"0.01"},{"physical_step":"4","pseudo_step":"1000","0_cont":"1e-8","1_momx":"1e-8"}]
	}`))
	context.Request.Header.Set("Content-Type", "application/json")

	app.interpretResult(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "Residuals decrease") {
		t.Fatalf("unexpected response %d: %s", recorder.Code, recorder.Body.String())
	}
	for _, expected := range []string{
		`4000`, `Simplified Chinese`, `Field dictionary`, `EVERY supplied field`,
		`continuity/mass-conservation`, `momentum equation residuals`, `per-step pseudo-convergence`,
		`nonlinear_residual_v2.csv`, `0_cont`, `1_momx`,
	} {
		if !strings.Contains(providerBody, expected) {
			t.Fatalf("provider prompt is missing %q: %s", expected, providerBody)
		}
	}
}

func TestInterpretResultRequiresConfiguredProvider(t *testing.T) {
	gin.SetMode(gin.TestMode)
	app := &Server{agent: &agent.Service{Provider: "builtin"}}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/interpret-result", strings.NewReader(`{}`))

	app.interpretResult(context)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("got status %d, want 503", recorder.Code)
	}
}
