package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/projectcache"
	"github.com/sunjuzhong/vibe-flow360/internal/projectmirror"
)

type fakeProjectSyncClient struct {
	mu                      sync.Mutex
	details                 map[string]flow360.ResourceDetail
	failures                map[string]error
	visualizationFailure    error
	visualization           *flow360.ResourceVisualization
	visualizationCalls      int
	visualizationAssetCalls int
	calls                   map[string]int
	delay                   time.Duration
}

func (f *fakeProjectSyncClient) ResourceVisualization(_ context.Context, resourceType, resourceID string) (flow360.ResourceVisualization, error) {
	f.mu.Lock()
	f.visualizationCalls++
	f.mu.Unlock()
	if f.visualizationFailure != nil {
		return flow360.ResourceVisualization{}, f.visualizationFailure
	}
	if f.visualization != nil {
		return *f.visualization, nil
	}
	return flow360.ResourceVisualization{
		Manifest: json.RawMessage(`[
			{"id":"body-1","type":"SolidGeometry","properties":{"boundsMin":[-1,-1,-1],"boundsMax":[1,1,1]},"resources":{"buffers":{"type":"buffers","path":"body.bin","sections":[{"name":"position","length":36}]}}},
			{"id":"face-1","name":"Face 1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}}
		]`),
		Bins: map[string][]byte{"body.bin": {1, 2, 3}},
	}, nil
}

func (f *fakeProjectSyncClient) ResourceVisualizationAsset(_ context.Context, _, _ string, relative string) (flow360.VisualizationFile, error) {
	f.mu.Lock()
	f.visualizationAssetCalls++
	f.mu.Unlock()
	if f.visualizationFailure != nil {
		return flow360.VisualizationFile{}, f.visualizationFailure
	}
	if f.visualization == nil {
		return flow360.VisualizationFile{}, os.ErrNotExist
	}
	payload, ok := f.visualization.Bins[relative]
	if !ok {
		return flow360.VisualizationFile{}, os.ErrNotExist
	}
	path := filepath.Join(os.TempDir(), "vibesim-test-"+filepath.Base(relative))
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		return flow360.VisualizationFile{}, err
	}
	return flow360.VisualizationFile{Path: path}, nil
}

func (f *fakeProjectSyncClient) ResourceResult(_ context.Context, resourceType, resourceID, relative string) ([]byte, string, error) {
	if resourceType != "Case" || resourceID == "" {
		return nil, "", errors.New("invalid result resource")
	}
	f.mu.Lock()
	if f.calls == nil {
		f.calls = map[string]int{}
	}
	f.calls["result/"+relative]++
	f.mu.Unlock()
	return []byte("iteration,residual\n1,0.1\n"), "text/plain; charset=utf-8", nil
}

func (f *fakeProjectSyncClient) ResourceResultPreview(ctx context.Context, resourceType, resourceID, relative string) ([]byte, error) {
	payload, _, err := f.ResourceResult(ctx, resourceType, resourceID, relative)
	return payload, err
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
	return f.resource(resourceType, resourceID)
}

func (f *fakeProjectSyncClient) ResourceMetadata(_ context.Context, resourceType, resourceID string) (flow360.ResourceDetail, error) {
	detail, err := f.resource(resourceType, resourceID)
	if err != nil {
		return detail, err
	}
	detail.Summary = nil
	detail.SimulationParams = nil
	detail.Results = nil
	return detail, nil
}

func (f *fakeProjectSyncClient) resource(resourceType, resourceID string) (flow360.ResourceDetail, error) {
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

func TestSyncProjectDoesNotOverwriteSuccessfulResourceWithCriticalPartialData(t *testing.T) {
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {
				ID:     "geo-1",
				Type:   "Geometry",
				Errors: map[string]string{"simulation_params": "request timed out"},
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

func TestSyncProjectKeepsResourceWhenOnlySummaryIsUnavailable(t *testing.T) {
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {
				ID:               "geo-1",
				Type:             "Geometry",
				Info:             json.RawMessage(`{"status":"processed"}`),
				State:            json.RawMessage(`{"status":"processed"}`),
				SimulationParams: json.RawMessage(`{"meshing":{"defaults":{}}}`),
				Errors:           map[string]string{"summary": "25.11 schema is not installed"},
			},
			"Case/case-1": {
				ID:               "case-1",
				Type:             "Case",
				SimulationParams: json.RawMessage(`{"models":[]}`),
				Errors:           map[string]string{},
			},
		},
		failures: map[string]error{},
	}
	app := newProjectSyncTestServer(t, client)

	manifest := app.syncProject(t.Context(), "prj-1", client)
	if manifest.Status != projectmirror.StatusPartial || manifest.SyncedResources != 2 || manifest.FailedResources != 0 {
		t.Fatalf("unexpected manifest %#v", manifest)
	}
	status := manifest.Resources["Geometry/geo-1"]
	if status.Status != "partial" || !strings.Contains(status.Error, "25.11 schema is not installed") {
		t.Fatalf("summary degradation was not retained: %#v", status)
	}
	payload, _, err := app.mirror.ResourceDetail("Geometry", "geo-1")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(payload, []byte(`"simulation_params"`)) {
		t.Fatalf("metadata-only synchronization retained SimulationParams: %s", payload)
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

func TestResourceMeshPreviewReusesVisualizationUnlessForced(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, resource := range []struct{ type_, id string }{{"Geometry", "geo-1"}, {"Case", "case-1"}} {
		t.Run(resource.type_, func(t *testing.T) {
			client := &fakeProjectSyncClient{
				details: map[string]flow360.ResourceDetail{
					"Geometry/geo-1": {ID: "geo-1", Type: "Geometry", Errors: map[string]string{}},
					"Case/case-1":    {ID: "case-1", Type: "Case", Errors: map[string]string{}},
				},
				failures: map[string]error{},
			}
			app := newProjectSyncTestServer(t, client)
			app.syncProject(t.Context(), "prj-1", client)

			requestPreview := func(force bool) *httptest.ResponseRecorder {
				recorder := httptest.NewRecorder()
				requestContext, _ := gin.CreateTestContext(recorder)
				path := fmt.Sprintf("/api/flow360/resources/%s/%s/preview-mesh", resource.type_, resource.id)
				if force {
					path += "?force=true"
				}
				requestContext.Request = httptest.NewRequest(http.MethodGet, path, nil)
				requestContext.Params = gin.Params{
					{Key: "resource_type", Value: resource.type_},
					{Key: "resource_id", Value: resource.id},
				}
				app.flow360ResourceMeshPreview(requestContext)
				return recorder
			}
			if first := requestPreview(false); first.Code != http.StatusOK {
				t.Fatalf("first preview got %d: %s", first.Code, first.Body)
			}
			if second := requestPreview(false); second.Code != http.StatusOK {
				t.Fatalf("cached preview got %d: %s", second.Code, second.Body)
			}
			if forced := requestPreview(true); forced.Code != http.StatusOK {
				t.Fatalf("forced preview got %d: %s", forced.Code, forced.Body)
			}
			client.mu.Lock()
			defer client.mu.Unlock()
			if client.visualizationCalls != 2 {
				t.Fatalf("visualization downloaded %d times, want initial and forced downloads", client.visualizationCalls)
			}
		})
	}
}

func TestResourceResultReusesLocalFileUnlessForced(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {ID: "geo-1", Type: "Geometry", Errors: map[string]string{}},
			"Case/case-1": {
				ID: "case-1", Type: "Case", Info: json.RawMessage(`{"project_id":"prj-1"}`), Errors: map[string]string{},
			},
		},
		failures: map[string]error{},
	}
	app := newProjectSyncTestServer(t, client)
	app.syncProject(t.Context(), "prj-1", client)

	requestPreview := func(force bool) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		requestContext, _ := gin.CreateTestContext(recorder)
		path := "/api/flow360/resources/Case/case-1/preview?path=results%2Fresidual.csv"
		if force {
			path += "&force=true"
		}
		requestContext.Request = httptest.NewRequest(http.MethodGet, path, nil)
		requestContext.Params = gin.Params{
			{Key: "resource_type", Value: "Case"},
			{Key: "resource_id", Value: "case-1"},
		}
		app.flow360ResourcePreview(requestContext)
		return recorder
	}
	if response := requestPreview(false); response.Code != http.StatusOK {
		t.Fatalf("initial result preview got %d: %s", response.Code, response.Body)
	}
	downloadRecorder := httptest.NewRecorder()
	downloadContext, _ := gin.CreateTestContext(downloadRecorder)
	downloadContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Case/case-1/download?path=results%2Fresidual.csv", nil)
	downloadContext.Params = gin.Params{
		{Key: "resource_type", Value: "Case"},
		{Key: "resource_id", Value: "case-1"},
	}
	app.flow360ResourceDownload(downloadContext)
	if downloadRecorder.Code != http.StatusOK {
		t.Fatalf("cached result download got %d: %s", downloadRecorder.Code, downloadRecorder.Body)
	}
	if response := requestPreview(true); response.Code != http.StatusOK {
		t.Fatalf("forced result preview got %d: %s", response.Code, response.Body)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if calls := client.calls["result/results/residual.csv"]; calls != 2 {
		t.Fatalf("result downloaded %d times, want initial and forced downloads", calls)
	}
}

func TestResourceMeshPreviewReturnsVisualizationErrorWithoutLegacyDetailFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {ID: "geo-1", Type: "Geometry", Errors: map[string]string{}},
		},
		failures:             map[string]error{},
		visualizationFailure: errors.New("manifest exceeds the supported size"),
	}
	app := newProjectSyncTestServer(t, client)
	app.syncProject(t.Context(), "prj-1", client)

	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/preview-mesh", nil)
	requestContext.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "geo-1"},
	}
	app.flow360ResourceMeshPreview(requestContext)

	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), "manifest exceeds") {
		t.Fatalf("unexpected preview error %d: %s", recorder.Code, recorder.Body)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.calls["Geometry/geo-1"] != 1 {
		t.Fatalf("legacy detail fallback was called %d times, want sync metadata only", client.calls["Geometry/geo-1"])
	}
}

func TestResourceMeshPreviewReturnsFriendlyCapacityError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	technical := &flow360.VisualizationError{
		Kind:         flow360.VisualizationTooLarge,
		ResourceType: "Geometry",
		Err:          errors.New("visualization manifest exceeds the 512 MiB remote limit"),
	}
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {ID: "geo-1", Type: "Geometry", Errors: map[string]string{}},
		},
		failures:             map[string]error{},
		visualizationFailure: technical,
	}
	app := newProjectSyncTestServer(t, client)
	app.syncProject(t.Context(), "prj-1", client)

	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/preview-mesh", nil)
	requestContext.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "geo-1"},
	}
	app.flow360ResourceMeshPreview(requestContext)

	var response map[string]any
	if json.Unmarshal(recorder.Body.Bytes(), &response) != nil {
		t.Fatalf("invalid response: %s", recorder.Body)
	}
	if recorder.Code != http.StatusServiceUnavailable || response["code"] != "visualization_too_large" {
		t.Fatalf("unexpected capacity response %d: %s", recorder.Code, recorder.Body)
	}
	if !strings.Contains(response["error"].(string), "contact the software development team") ||
		!strings.Contains(response["technical_error"].(string), "512 MiB") {
		t.Fatalf("friendly and technical errors were not separated: %#v", response)
	}

	cachedRecorder := httptest.NewRecorder()
	cachedContext, _ := gin.CreateTestContext(cachedRecorder)
	cachedContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/preview-mesh", nil)
	cachedContext.Params = requestContext.Params
	app.flow360ResourceMeshPreview(cachedContext)
	if cachedRecorder.Code != http.StatusServiceUnavailable || cachedRecorder.Header().Get("X-VibeSim-Data-Source") != "cache" {
		t.Fatalf("cached capacity response got %d: %s", cachedRecorder.Code, cachedRecorder.Body)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.visualizationCalls != 1 {
		t.Fatalf("oversized visualization attempted %d downloads, want one", client.visualizationCalls)
	}
}

func TestVisualizationManifestBrowserSafe(t *testing.T) {
	if !visualizationManifestBrowserSafe("Geometry", json.RawMessage(strings.Repeat(" ", browserVisualizationManifestLimit)+`[]`)) {
		t.Fatal("compact manifest with large formatting whitespace was rejected")
	}
	large, err := json.Marshal(strings.Repeat("x", browserVisualizationManifestLimit))
	if err != nil {
		t.Fatal(err)
	}
	if visualizationManifestBrowserSafe("Geometry", large) {
		t.Fatal("manifest over the browser limit was accepted")
	}
	if !visualizationManifestBrowserSafe("Case", large) {
		t.Fatal("Case manifest within the relaxed browser limit was rejected")
	}
}

func TestResourceMeshPreviewNormalizesLocalManifestWithoutRedownload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Case/case-1": {ID: "case-1", Type: "Case", Errors: map[string]string{}},
		},
		failures: map[string]error{},
	}
	app := newProjectSyncTestServer(t, client)
	app.syncProject(t.Context(), "prj-1", client)
	staleManifest := json.RawMessage(`[
		{"id":"root","type":"GeometryGroup","attributions":{"members":["body-1","placeholder"]}},
		{"id":"body-1","type":"SolidGeometry","resources":{"buffers":{"type":"buffers","path":"body.bin","sections":[{"name":"position","length":36}]}}},
		{"id":"placeholder","type":"SolidGeometry"}
	]`)
	if _, err := app.mirror.PutResourceVisualization(
		"prj-1", "Case", "case-1", staleManifest, map[string][]byte{"body.bin": {1, 2, 3}}, 0,
	); err != nil {
		t.Fatal(err)
	}

	requestPreview := func() *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		requestContext, _ := gin.CreateTestContext(recorder)
		requestContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Case/case-1/preview-mesh", nil)
		requestContext.Params = gin.Params{
			{Key: "resource_type", Value: "Case"},
			{Key: "resource_id", Value: "case-1"},
		}
		app.flow360ResourceMeshPreview(requestContext)
		return recorder
	}
	if first := requestPreview(); first.Code != http.StatusOK {
		t.Fatalf("refreshed preview got %d: %s", first.Code, first.Body)
	} else if !bytes.Contains(first.Body.Bytes(), []byte("manifest.json?v=")) {
		t.Fatalf("preview manifest URL has no cache fingerprint: %s", first.Body)
	}
	if second := requestPreview(); second.Code != http.StatusOK {
		t.Fatalf("cached refreshed preview got %d: %s", second.Code, second.Body)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.visualizationCalls != 0 {
		t.Fatalf("visualization downloaded %d times, want local manifest reuse", client.visualizationCalls)
	}
}

func TestResourceMeshPreviewUsesLocalManifestAndDownloadsMissingAssetOnDemand(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manifest := json.RawMessage(`[
		{"id":"body-1","type":"SolidGeometry","properties":{"boundsMin":[-1,-1,-1],"boundsMax":[1,1,1]},"resources":{"buffers":{"type":"buffers","path":"body.bin","sections":[{"name":"position","length":36}]}}},
		{"id":"face-1","name":"Face 1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}}
	]`)
	visualization := flow360.ResourceVisualization{
		Manifest: manifest,
		Bins:     map[string][]byte{"body.bin": {1, 2, 3}},
	}
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Case/case-1": {ID: "case-1", Type: "Case", Errors: map[string]string{}},
		},
		failures:      map[string]error{},
		visualization: &visualization,
	}
	app := newProjectSyncTestServer(t, client)
	app.syncProject(t.Context(), "prj-1", client)
	if _, err := app.mirror.PutResourceVisualization("prj-1", "Case", "case-1", manifest, map[string][]byte{}, 0); err != nil {
		t.Fatal(err)
	}

	previewRecorder := httptest.NewRecorder()
	previewContext, _ := gin.CreateTestContext(previewRecorder)
	previewContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Case/case-1/preview-mesh", nil)
	previewContext.Params = gin.Params{
		{Key: "resource_type", Value: "Case"},
		{Key: "resource_id", Value: "case-1"},
	}
	app.flow360ResourceMeshPreview(previewContext)
	if previewRecorder.Code != http.StatusOK {
		t.Fatalf("local manifest preview got %d: %s", previewRecorder.Code, previewRecorder.Body)
	}

	assetRecorder := httptest.NewRecorder()
	assetContext, _ := gin.CreateTestContext(assetRecorder)
	assetContext.Request = httptest.NewRequest(http.MethodGet, "/asset", nil)
	assetContext.Params = gin.Params{
		{Key: "resource_type", Value: "Case"},
		{Key: "resource_id", Value: "case-1"},
		{Key: "asset_path", Value: "/body.bin"},
	}
	app.flow360ResourceVisualizationAsset(assetContext)
	if assetRecorder.Code != http.StatusOK || !bytes.Equal(assetRecorder.Body.Bytes(), []byte{1, 2, 3}) {
		t.Fatalf("on-demand asset got %d: %v", assetRecorder.Code, assetRecorder.Body.Bytes())
	}

	client.mu.Lock()
	defer client.mu.Unlock()
	if client.visualizationCalls != 0 || client.visualizationAssetCalls != 1 {
		t.Fatalf("downloads: visualization=%d asset=%d, want 0 and 1", client.visualizationCalls, client.visualizationAssetCalls)
	}
}

func TestCaseMeshPreviewRepairsMirrorIdentityFromDetailCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &fakeProjectSyncClient{failures: map[string]error{}}
	app := newProjectSyncTestServer(t, client)
	detail := json.RawMessage(`{"id":"case-cache","type":"Case","info":{"project_id":"prj-cache"}}`)
	if _, err := app.cache.Put("resource-detail", "Case/case-cache", detail); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Case/case-cache/preview-mesh", nil)
	requestContext.Params = gin.Params{
		{Key: "resource_type", Value: "Case"},
		{Key: "resource_id", Value: "case-cache"},
	}
	app.flow360ResourceMeshPreview(requestContext)
	if recorder.Code != http.StatusOK {
		t.Fatalf("Case preview got %d: %s", recorder.Code, recorder.Body)
	}
	if projectID, err := app.mirror.ResourceProjectID("Case", "case-cache"); err != nil || projectID != "prj-cache" {
		t.Fatalf("mirror identity was not repaired: project=%q err=%v", projectID, err)
	}
}

func TestResourceVisualizationAssetDownloadsMissingLODOnDemand(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manifest := json.RawMessage(`[
		{"id":"body-1","type":"SolidGeometry","properties":{"boundsMin":[-1,-1,-1],"boundsMax":[1,1,1]},"resources":{"buffers":{"type":"lod","default":1,"levels":[
			{"path":"body-high.bin","sections":[{"name":"position","length":36}]},
			{"path":"body-low.bin","sections":[{"name":"position","length":36}]}
		]}}},
		{"id":"face-1","name":"Face 1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}}
	]`)
	visualization := flow360.ResourceVisualization{
		Manifest: manifest,
		Bins: map[string][]byte{
			"body-high.bin": {4, 5, 6},
			"body-low.bin":  {1, 2, 3},
		},
	}
	client := &fakeProjectSyncClient{
		details: map[string]flow360.ResourceDetail{
			"Geometry/geo-1": {ID: "geo-1", Type: "Geometry", Errors: map[string]string{}},
			"Case/case-1":    {ID: "case-1", Type: "Case", Errors: map[string]string{}},
		},
		failures:      map[string]error{},
		visualization: &visualization,
	}
	app := newProjectSyncTestServer(t, client)
	app.syncProject(t.Context(), "prj-1", client)
	if _, err := app.mirror.PutResourceVisualization(
		"prj-1",
		"Geometry",
		"geo-1",
		manifest,
		map[string][]byte{"body-low.bin": {1, 2, 3}},
		1,
	); err != nil {
		t.Fatal(err)
	}

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
	if preview := requestPreview(); preview.Code != http.StatusOK {
		t.Fatalf("preview got %d: %s", preview.Code, preview.Body)
	}
	assetRecorder := httptest.NewRecorder()
	assetContext, _ := gin.CreateTestContext(assetRecorder)
	assetContext.Request = httptest.NewRequest(http.MethodGet, "/asset", nil)
	assetContext.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "geo-1"},
		{Key: "asset_path", Value: "/body-high.bin"},
	}
	app.flow360ResourceVisualizationAsset(assetContext)
	if assetRecorder.Code != http.StatusOK || !bytes.Equal(assetRecorder.Body.Bytes(), []byte{4, 5, 6}) {
		t.Fatalf("high precision asset got %d: %v", assetRecorder.Code, assetRecorder.Body.Bytes())
	}
	forcedRecorder := httptest.NewRecorder()
	forcedContext, _ := gin.CreateTestContext(forcedRecorder)
	forcedContext.Request = httptest.NewRequest(http.MethodGet, "/asset?force=true", nil)
	forcedContext.Params = assetContext.Params
	app.flow360ResourceVisualizationAsset(forcedContext)
	if forcedRecorder.Code != http.StatusOK || !bytes.Equal(forcedRecorder.Body.Bytes(), []byte{4, 5, 6}) {
		t.Fatalf("forced high precision asset got %d: %v", forcedRecorder.Code, forcedRecorder.Body.Bytes())
	}
	if payload, err := app.mirror.ResourceVisualizationFile("Geometry", "geo-1", "body-high.bin"); err != nil || len(payload) == 0 {
		t.Fatalf("high precision LOD was not repaired: payload=%v err=%v", payload, err)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.visualizationCalls != 0 || client.visualizationAssetCalls != 2 {
		t.Fatalf("downloads: visualization=%d asset=%d, want 0 and 2", client.visualizationCalls, client.visualizationAssetCalls)
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
