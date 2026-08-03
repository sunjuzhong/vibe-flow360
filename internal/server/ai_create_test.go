package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func TestAICreateProjectGeneratesProjectAndCasePlan(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	fakeFlow360 := filepath.Join(root, "flow360")
	script := `#!/bin/sh
printf '%s' '{"project_id":"project-ai-1","geometry_id":"geometry-ai-1"}'
`
	if err := os.WriteFile(fakeFlow360, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	planStore, err := plans.NewStore(filepath.Join(root, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: fakeFlow360, Timeout: time.Second},
		plans:   planStore,
		workDir: root,
	}

	body := bytes.NewBufferString(`{"intent":"帮我实现一个圆柱扰流的仿真试验","folder_id":"folder-1"}`)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/ai-create", body)
	context.Request.Header.Set("Content-Type", "application/json")
	app.aiCreateProject(context)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response aiCreateResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.ProjectID != "project-ai-1" || response.RootResourceID != "geometry-ai-1" {
		t.Fatalf("unexpected remote IDs: %#v", response)
	}
	if response.Plan.Target != "case" || response.Plan.ProjectID != response.ProjectID || len(response.Plan.Patch) == 0 {
		t.Fatalf("expected preloaded Case plan: %#v", response.Plan)
	}
	if _, err := os.Stat(filepath.Join(root, "ai-create")); err != nil {
		t.Fatalf("expected durable staging root: %v", err)
	}
}

func TestAICreateProjectRequiresFolder(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/ai-create", bytes.NewBufferString(`{"intent":"cylinder flow"}`))
	context.Request.Header.Set("Content-Type", "application/json")
	(&Server{}).aiCreateProject(context)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got %d", recorder.Code)
	}
}
