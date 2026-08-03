package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func TestAICreateProjectGeneratesProjectAndCasePlan(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	fakeFlow360 := filepath.Join(root, "flow360")
	script := `#!/bin/sh
case " $* " in
  *" project create "*)
    case " $* " in *" --sync "*) ;; *) exit 9 ;; esac
    case " $* " in *"/cylinder.brep "*) ;; *) exit 10 ;; esac
    printf '%s' '{"project_id":"project-ai-1"}'
    ;;
  *" project items project-ai-1 "*)
    printf '%s' '{"items":[{"id":"geometry-ai-1","name":"Cylinder","parent_id":null,"type":"Geometry"}]}'
    ;;
  *) exit 8 ;;
esac
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

func TestNormalizeAICreateResultRetriesUntilAsyncRootAppears(t *testing.T) {
	lookups := 0
	lookup := func(_ context.Context, projectID string) (json.RawMessage, error) {
		lookups++
		if projectID != "project-ai-2" {
			t.Fatalf("unexpected project ID %q", projectID)
		}
		if lookups == 1 {
			return json.RawMessage(`{"items":[]}`), nil
		}
		return json.RawMessage(`{"items":[{"id":"geometry-ai-2","type":"Geometry","parent_id":null}]}`), nil
	}
	normalized, err := normalizeAICreateResultWithLookup(
		context.Background(), json.RawMessage(`{"project_id":"project-ai-2"}`),
		"geometry", lookup, 3, time.Millisecond,
	)
	if err != nil {
		t.Fatal(err)
	}
	if lookups != 2 || !bytes.Contains(normalized, []byte(`"root_resource_id":"geometry-ai-2"`)) {
		t.Fatalf("unexpected recovery after %d lookups: %s", lookups, normalized)
	}
}

func TestNormalizeAICreateResultReportsCreatedProjectWhenRootNeverAppears(t *testing.T) {
	lookup := func(context.Context, string) (json.RawMessage, error) {
		return nil, errors.New("not ready")
	}
	_, err := normalizeAICreateResultWithLookup(
		context.Background(), json.RawMessage(`{"project_id":"project-ai-3"}`),
		"geometry", lookup, 2, time.Millisecond,
	)
	if err == nil || !bytes.Contains([]byte(err.Error()), []byte("Project project-ai-3 was created")) {
		t.Fatalf("unexpected error: %v", err)
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

func TestValidateAICreateAssetRejectsSTLAsGeometry(t *testing.T) {
	root := t.TempDir()
	stlPath := filepath.Join(root, "cylinder.stl")
	if err := os.WriteFile(stlPath, []byte("solid cylinder\nfacet normal 0 0 1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateAICreateAsset(stlPath, "geometry"); err == nil {
		t.Fatal("STL was accepted as CAD Geometry")
	}
	fakeBREP := filepath.Join(root, "renamed.brep")
	if err := os.WriteFile(fakeBREP, []byte("solid cylinder\nfacet normal 0 0 1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateAICreateAsset(fakeBREP, "geometry"); err == nil {
		t.Fatal("renamed STL was accepted as BREP Geometry")
	}
	brepPath := filepath.Join(root, "cylinder.brep")
	file, err := os.Create(brepPath)
	if err != nil {
		t.Fatal(err)
	}
	blueprint, _ := aicreate.FromIntent("cylinder flow")
	writeErr := aicreate.WriteCylinderBREP(file, blueprint.Geometry)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		t.Fatalf("write BREP: %v / %v", writeErr, closeErr)
	}
	if err := validateAICreateAsset(brepPath, "geometry"); err != nil {
		t.Fatalf("validated BREP was rejected: %v", err)
	}
}
