package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/projectcache"
	"github.com/sunjuzhong/vibe-flow360/internal/projectmirror"
)

type fakeProjectSyncClient struct {
	mu                   sync.Mutex
	details              map[string]flow360.ResourceDetail
	failures             map[string]error
	visualizationFailure error
	visualizationCalls   int
	calls                map[string]int
	delay                time.Duration
}

func (f *fakeProjectSyncClient) ResourceVisualization(_ context.Context, resourceType, resourceID string) (flow360.ResourceVisualization, error) {
	f.mu.Lock()
	f.visualizationCalls++
	f.mu.Unlock()
	if f.visualizationFailure != nil {
		return flow360.ResourceVisualization{}, f.visualizationFailure
	}
	return flow360.ResourceVisualization{
		Manifest: json.RawMessage(`[
			{"id":"body-1","type":"SolidGeometry","properties":{"boundsMin":[-1,-1,-1],"boundsMax":[1,1,1]},"resources":{"buffers":{"type":"buffers","path":"body.bin","sections":[{"name":"position","length":36}]}}},
			{"id":"face-1","name":"Face 1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}}
		]`),
		Bins: map[string][]byte{"body.bin": {1, 2, 3}},
	}, nil
}

func (f *fakeProjectSyncClient) ProjectInfo(context.Context, string) (json.RawMessage, error) {
	return json.RawMessage(`{"id":"prj-1","name":"Test","root_item":{"id":"geo-1","type":"Geometry"}}`), nil
}

func (f *fakeProjectSyncClient) ProjectTree(context.Context, string) (json.RawMessage, error) {
	return json.RawMessage(`{"root":{"id":"geo-1","name":"Geometry","type":"Geometry","children":[{"id":"case-1","name":"Case","type":"Case","children":[]}]}}`), nil
}

func (f *fakeProjectSyncClient) ProjectItems(context.Context, string) (json.RawMessage, error) {
	return json.RawMessage(`{"items":[{"id":"geo-1","type":"Geometry"},{"id":"case-1","type":"Case"}]}`), nil
}

func (f *fakeProjectSyncClient) ResourceDetail(_ context.Context, resourceType, resourceID string) (flow360.ResourceDetail, error) {
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	key := resourceType + "/" + resourceID
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.calls == nil {
		f.calls = map[string]int{}
	}
	f.calls[key]++
	if err := f.failures[key]; err != nil {
		return flow360.ResourceDetail{}, err
	}
	return f.details[key], nil
}

func newProjectSyncTestServer(t *testing.T, client projectSyncClient) *Server {
	t.Helper()
	dir := t.TempDir()
	cache, err := projectcache.New(filepath.Join(dir, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	mirror, err := projectmirror.New(filepath.Join(dir, "projects"), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	return &Server{
		cache:             cache,
		mirror:            mirror,
		projectSyncClient: client,
		projectSyncJobs:   map[string]struct{}{},
	}
}

func TestSyncProjectWritesEveryResourceAndCompatibilityCache(t *testing.T) {
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {
				ID:               "geo-1",
				Type:             "Geometry",
				Info:             json.RawMessage(`{"project_id":"prj-1"}`),
				State:            json.RawMessage(`{"status":"completed"}`),
				Summary:          json.RawMessage(`{"bodies":1}`),
				SimulationParams: json.RawMessage(`{"simulation_params":{}}`),
				Errors:           map[string]string{},
			},
			"Case/case-1": {
				ID:               "case-1",
				Type:             "Case",
				Info:             json.RawMessage(`{"project_id":"prj-1"}`),
				State:            json.RawMessage(`{"status":"completed"}`),
				Summary:          json.RawMessage(`{"case":"summary"}`),
				SimulationParams: json.RawMessage(`{"simulation_params":{}}`),
				Results:          json.RawMessage(`{"records":[]}`),
				Errors:           map[string]string{},
			},
		},
		failures: map[string]error{},
	}
	app := newProjectSyncTestServer(t, client)

	manifest := app.syncProject(t.Context(), "prj-1", client)
	if manifest.Status != projectmirror.StatusCompleted {
		t.Fatalf("unexpected manifest %#v", manifest)
	}
	if manifest.TotalResources != 2 || manifest.SyncedResources != 2 || manifest.FailedResources != 0 {
		t.Fatalf("unexpected progress %#v", manifest)
	}
	projectDir, err := app.mirror.ProjectDir("prj-1")
	if err != nil {
		t.Fatal(err)
	}
	for _, relative := range []string{
		"project.json",
		"tree.json",
		"items.json",
		filepath.Join("resources", "Geometry", "geo-1", "detail.json"),
		filepath.Join("resources", "Case", "case-1", "detail.json"),
	} {
		if _, err := os.Stat(filepath.Join(projectDir, relative)); err != nil {
			t.Fatalf("%s is missing: %v", relative, err)
		}
	}
	if _, err := app.cache.Get("resource-detail", "Case/case-1"); err != nil {
		t.Fatalf("compatibility cache is missing: %v", err)
	}
	if client.visualizationCalls != 0 {
		t.Fatalf("initial synchronization downloaded %d visualizations, want none", client.visualizationCalls)
	}
}

func TestSyncProjectDoesNotOverwriteSuccessfulResourceWithPartialData(t *testing.T) {
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {
				ID:     "geo-1",
				Type:   "Geometry",
				Errors: map[string]string{"summary": "summary is unavailable"},
			},
			"Case/case-1": {
				ID:     "case-1",
				Type:   "Case",
				Errors: map[string]string{},
			},
		},
		failures: map[string]error{"Case/case-1": errors.New("network unavailable")},
	}
	app := newProjectSyncTestServer(t, client)
	old := json.RawMessage(`{"id":"geo-1","type":"Geometry","summary":{"complete":true}}`)
	if err := app.mirror.PutResource("prj-1", "Geometry", "geo-1", old); err != nil {
		t.Fatal(err)
	}

	manifest := app.syncProject(t.Context(), "prj-1", client)
	if manifest.Status != projectmirror.StatusFailed || manifest.FailedResources != 2 {
		t.Fatalf("unexpected manifest %#v", manifest)
	}
	projectDir, err := app.mirror.ProjectDir("prj-1")
	if err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(filepath.Join(projectDir, "resources", "Geometry", "geo-1", "detail.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if got["summary"].(map[string]any)["complete"] != true {
		t.Fatalf("previous complete mirror was overwritten: %s", payload)
	}
}

func TestStartProjectSyncJoinsConcurrentRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {ID: "geo-1", Type: "Geometry", Errors: map[string]string{}},
			"Case/case-1":    {ID: "case-1", Type: "Case", Errors: map[string]string{}},
		},
		failures: map[string]error{},
		delay:    75 * time.Millisecond,
	}
	app := newProjectSyncTestServer(t, client)

	callStart := func() *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/projects/prj-1/sync", nil)
		context.Params = gin.Params{{Key: "project_id", Value: "prj-1"}}
		app.startProjectSync(context)
		return recorder
	}
	first := callStart()
	second := callStart()
	if first.Code != http.StatusAccepted || second.Code != http.StatusAccepted {
		t.Fatalf("unexpected statuses %d and %d", first.Code, second.Code)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		manifest, err := app.mirror.GetManifest("prj-1")
		if err == nil && manifest.Status == projectmirror.StatusCompleted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("synchronization did not finish")
		}
		time.Sleep(10 * time.Millisecond)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	for _, key := range []string{"Geometry/geo-1", "Case/case-1"} {
		if client.calls[key] != 1 {
			t.Fatalf("%s synchronized %d times, want once", key, client.calls[key])
		}
	}
}

func TestStartProjectSyncReusesFreshCompletedMirror(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {ID: "geo-1", Type: "Geometry", Errors: map[string]string{}},
			"Case/case-1":    {ID: "case-1", Type: "Case", Errors: map[string]string{}},
		},
		failures: map[string]error{},
	}
	app := newProjectSyncTestServer(t, client)
	if manifest := app.syncProject(t.Context(), "prj-1", client); manifest.Status != projectmirror.StatusCompleted {
		t.Fatalf("unexpected manifest %#v", manifest)
	}

	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/projects/prj-1/sync", nil)
	requestContext.Params = gin.Params{{Key: "project_id", Value: "prj-1"}}
	app.startProjectSync(requestContext)
	if recorder.Code != http.StatusOK {
		t.Fatalf("fresh sync got status %d, want 200: %s", recorder.Code, recorder.Body)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	for _, key := range []string{"Geometry/geo-1", "Case/case-1"} {
		if client.calls[key] != 1 {
			t.Fatalf("fresh mirror resynchronized %s %d times", key, client.calls[key])
		}
	}
}

func TestResourceMeshPreviewDownloadsVisualizationOnDemandOnce(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {ID: "geo-1", Type: "Geometry", Errors: map[string]string{}},
			"Case/case-1":    {ID: "case-1", Type: "Case", Errors: map[string]string{}},
		},
		failures: map[string]error{},
	}
	app := newProjectSyncTestServer(t, client)
	app.syncProject(t.Context(), "prj-1", client)

	requestPreview := func() *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		requestContext, _ := gin.CreateTestContext(recorder)
		requestContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/preview-mesh", nil)
		requestContext.Params = gin.Params{
			{Key: "resource_type", Value: "Geometry"},
			{Key: "resource_id", Value: "geo-1"},
		}
		app.flow360ResourceMeshPreview(requestContext)
		return recorder
	}
	if first := requestPreview(); first.Code != http.StatusOK {
		t.Fatalf("first preview got %d: %s", first.Code, first.Body)
	}
	if second := requestPreview(); second.Code != http.StatusOK {
		t.Fatalf("cached preview got %d: %s", second.Code, second.Body)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.visualizationCalls != 1 {
		t.Fatalf("visualization downloaded %d times, want once", client.visualizationCalls)
	}
}

func TestSyncProjectDefersVisualizationForAllResourceTypes(t *testing.T) {
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {
				ID:     "geo-1",
				Type:   "Geometry",
				Info:   json.RawMessage(`{"project_id":"prj-1"}`),
				Errors: map[string]string{},
			},
			"SurfaceMesh/sm-1": {
				ID:     "sm-1",
				Type:   "SurfaceMesh",
				Info:   json.RawMessage(`{"project_id":"prj-1"}`),
				Errors: map[string]string{},
			},
			"Case/case-1": {
				ID:     "case-1",
				Type:   "Case",
				Info:   json.RawMessage(`{"project_id":"prj-1"}`),
				Errors: map[string]string{},
			},
		},
		failures: map[string]error{},
	}
	// Override items to include SurfaceMesh
	itemsClient := &fakeProjectSyncClientWithItems{
		fakeProjectSyncClient: client,
		items:                 json.RawMessage(`{"items":[{"id":"geo-1","type":"Geometry"},{"id":"sm-1","type":"SurfaceMesh"},{"id":"case-1","type":"Case"}]}`),
	}
	app := newProjectSyncTestServer(t, itemsClient)

	manifest := app.syncProject(t.Context(), "prj-1", itemsClient)
	if manifest.Status != projectmirror.StatusCompleted {
		t.Fatalf("unexpected manifest %#v", manifest)
	}
	if manifest.TotalResources != 3 || manifest.SyncedResources != 3 {
		t.Fatalf("unexpected progress %#v", manifest)
	}
	// Resource metadata is mirrored, but large visualization files are fetched
	// only when a user opens a resource preview.
	for _, resource := range []struct {
		resourceType string
		resourceID   string
	}{
		{"Geometry", "geo-1"},
		{"SurfaceMesh", "sm-1"},
		{"Case", "case-1"},
	} {
		key := resource.resourceType + "/" + resource.resourceID
		if len(manifest.Resources[key].Artifacts) != 0 {
			t.Fatalf("%s unexpectedly recorded visualization artifacts", key)
		}
	}
	if client.visualizationCalls != 0 {
		t.Fatalf("initial synchronization downloaded %d visualizations, want none", client.visualizationCalls)
	}
}

// fakeProjectSyncClientWithItems wraps fakeProjectSyncClient with custom items response.
type fakeProjectSyncClientWithItems struct {
	*fakeProjectSyncClient
	items json.RawMessage
}

func (f *fakeProjectSyncClientWithItems) ProjectItems(context.Context, string) (json.RawMessage, error) {
	return f.items, nil
}
