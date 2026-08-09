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
  "path":"results/residual.csv","language":"zh-CN","total_rows":4000,"delimiter":"comma",
  "columns":[{"field":"step","kind":"numeric","count":4000,"missing":0,"unique":4000,"minimum":1,"maximum":4000,"mean":2000.5}],
  "sample_rows":[{"step":"1"},{"step":"4000"}]
}`))
	context.Request.Header.Set("Content-Type", "application/json")

	app.interpretResult(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "Residuals decrease") {
		t.Fatalf("unexpected response %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(providerBody, `4000`) || !strings.Contains(providerBody, `Simplified Chinese`) {
		t.Fatalf("provider did not receive bounded full-table summary: %s", providerBody)
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
