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
	"reflect"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/comparison"
	"github.com/sunjuzhong/vibe-flow360/internal/convergence"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/geometrydiag"
	importplans "github.com/sunjuzhong/vibe-flow360/internal/imports"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
	"github.com/sunjuzhong/vibe-flow360/internal/projectcache"
	"github.com/sunjuzhong/vibe-flow360/internal/projectmirror"
)

func TestWebAppHandlerDoesNotServeHTMLForMissingAssets(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dist := fstest.MapFS{
		"index.html":        {Data: []byte("<main>app</main>")},
		"assets/current.js": {Data: []byte("export default true")},
	}
	router := gin.New()
	router.NoRoute(webAppHandler(dist, []byte("<main>app</main>")))

	t.Run("missing hashed asset", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/assets/TutorialLibraryPage-old.js", nil))

		if recorder.Code != http.StatusNotFound {
			t.Fatalf("got status %d, want 404", recorder.Code)
		}
		if strings.Contains(recorder.Header().Get("Content-Type"), "text/html") {
			t.Fatalf("missing asset was served as HTML: %q", recorder.Header().Get("Content-Type"))
		}
		if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("got Cache-Control %q, want no-store", got)
		}
	})

	t.Run("client route", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/tutorials", nil))

		if recorder.Code != http.StatusOK || recorder.Body.String() != "<main>app</main>" {
			t.Fatalf("unexpected SPA response %d: %q", recorder.Code, recorder.Body.String())
		}
		if got := recorder.Header().Get("Cache-Control"); got != "no-cache" {
			t.Fatalf("got Cache-Control %q, want no-cache", got)
		}
	})

	t.Run("current hashed asset", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/assets/current.js", nil))

		if recorder.Code != http.StatusOK || recorder.Body.String() != "export default true" {
			t.Fatalf("unexpected asset response %d: %q", recorder.Code, recorder.Body.String())
		}
		if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
			t.Fatalf("got Cache-Control %q", got)
		}
	})
}

func TestTutorialCSMImportWaitsForProcessedGeometry(t *testing.T) {
	if !slices.Contains(allowedImportExtensions["geometry"], ".csm") {
		t.Fatal("tutorial CSM is not an allowed Geometry import")
	}
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "flow360")
	script := `#!/bin/sh
printf '%s\n' "$*" >> "` + argsPath + `"
if [ "$1 $2" = "project items" ]; then
  printf '{"items":[{"id":"geo-1","type":"Geometry","parent_id":null}]}'
else
  printf '{"id":"prj-1","type":"Project"}'
fi
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	store, err := importplans.New(filepath.Join(dir, "imports"))
	if err != nil {
		t.Fatal(err)
	}
	created, _, err := store.Create(importplans.Plan{
		Name: "T01 experiment", SourceType: "geometry", Unit: "m", Workflow: "standard",
		SolverVersion: "release-25.10", FolderID: "folder-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	file, err := store.AddFile(created.ID, "geometry.csm", strings.NewReader("despmtr tutorial"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.FinalizePlan(created.ID, []importplans.FileInfo{file}, file.SizeBytes, []string{"flow360"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(created.ID, func(plan *importplans.Plan) error {
		plan.Status = "approved"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}, imports: store}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "import_id", Value: created.ID}}
	context.Request = httptest.NewRequest(http.MethodPost, "/api/imports/"+created.ID+"/run?sync=true", nil)
	app.runImport(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"project_id":"prj-1"`) {
		t.Fatalf("unexpected import response %d: %s", recorder.Code, recorder.Body.String())
	}
	args, _ := os.ReadFile(argsPath)
	if !strings.Contains(string(args), "project create") || !strings.Contains(string(args), "--sync") || !strings.Contains(string(args), "geometry.csm") {
		t.Fatalf("tutorial import did not use synchronous project creation: %s", args)
	}
	if !strings.Contains(string(args), "project items prj-1") {
		t.Fatalf("tutorial import did not recover its Geometry from the created Project: %s", args)
	}
}

func TestCreateConfiguredDraftMergesPatchIntoRemoteBaseline(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	paramsPath := filepath.Join(dir, "params.json")
	binaryPath := filepath.Join(dir, "flow360")
	script := `#!/bin/sh
case "$*" in
  "draft list --project-id prj-1") printf '{"records":[]}' ;;
  "draft create geo-1 --name Tutorial baseline") printf '{"id":"dft-1","type":"Draft","name":"Tutorial baseline"}' ;;
  "draft info dft-1") printf '{"id":"dft-1","type":"Draft","source_id":"geo-1","source_type":"Geometry"}' ;;
  "draft state dft-1") printf '{"status":"draft"}' ;;
  "draft simulation-params get dft-1") printf '{"simulation_params":{"models":[],"operating_condition":{"alpha":{"value":0,"units":"degree"}}}}' ;;
  draft\ simulation-params\ set\ dft-1*) cp "$5" "` + paramsPath + `"; printf '{"status":"updated"}' ;;
  *) printf 'unexpected arguments: %s' "$*" >&2; exit 2 ;;
esac
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "project_id", Value: "prj-1"}}
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/projects/prj-1/drafts", strings.NewReader(`{
		"source_id":"geo-1","name":"Tutorial baseline",
		"patch":{"operating_condition":{"alpha":{"value":5,"units":"degree"}}}
	}`))
	context.Request.Header.Set("Content-Type", "application/json")
	app.createConfiguredFlow360Draft(context)
	if recorder.Code != http.StatusCreated || !strings.Contains(recorder.Body.String(), `"id":"dft-1"`) {
		t.Fatalf("unexpected configured Draft response %d: %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), `"simulation_params":{"simulation_params"`) {
		t.Fatalf("configured Draft response kept the CLI wrapper: %s", recorder.Body.String())
	}
	written, err := os.ReadFile(paramsPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(written), `"models":[]`) || !strings.Contains(string(written), `"value":5`) {
		t.Fatalf("Draft baseline was not preserved and patched: %s", written)
	}
}

func TestCreateConfiguredDraftCopiesExactSimulationParams(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	paramsPath := filepath.Join(dir, "params.json")
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "flow360")
	script := `#!/bin/sh
printf '%s\n' "$*" >> "` + argsPath + `"
case "$*" in
  "draft create geo-1 --name Copied Draft") printf '{"id":"dft-copy","type":"Draft"}' ;;
  "draft info dft-copy") printf '{"id":"dft-copy","type":"Draft","source_id":"geo-1"}' ;;
  "draft state dft-copy") printf '{"status":"draft"}' ;;
  "draft simulation-params get dft-copy") printf '{"simulation_params":{"baseline_only":true}}' ;;
  draft\ simulation-params\ set\ dft-copy*) cp "$5" "` + paramsPath + `"; printf '{"status":"updated"}' ;;
  *) exit 2 ;;
esac
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Params = gin.Params{{Key: "project_id", Value: "prj-1"}}
	requestContext.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/projects/prj-1/drafts", strings.NewReader(`{
		"source_id":"geo-1","name":"Copied Draft","simulation_params":{"copied":true}
	}`))
	requestContext.Request.Header.Set("Content-Type", "application/json")
	app.createConfiguredFlow360Draft(requestContext)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("unexpected copy response %d: %s", recorder.Code, recorder.Body.String())
	}
	written, _ := os.ReadFile(paramsPath)
	if string(written) != `{"copied":true}` {
		t.Fatalf("copy did not replace with exact SimulationParams: %s", written)
	}
	args, _ := os.ReadFile(argsPath)
	if strings.Contains(string(args), "draft list") {
		t.Fatalf("explicit creation reused a source Draft: %s", args)
	}
}

func TestConfiguredDraftCreationErrorExplainsErroredCase(t *testing.T) {
	got := configuredDraftCreationError(errors.New("flow360: Bad request error: You cannot fork a error case"))
	if !strings.Contains(got, "Volume Mesh base") {
		t.Fatalf("expected actionable errored Case message, got %q", got)
	}
}

func TestPatchDraftParametersMergesWithoutRunning(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	paramsPath := filepath.Join(dir, "params.json")
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "flow360")
	script := `#!/bin/sh
printf '%s\n' "$*" >> "` + argsPath + `"
case "$*" in
  "draft info draft-1") printf '{"id":"draft-1","type":"Draft"}' ;;
  "draft state draft-1") printf '{"status":"draft"}' ;;
  "draft simulation-params get draft-1") printf '{"simulation_params":{"operating_condition":{"alpha":0,"beta":2}}}' ;;
  draft\ simulation-params\ set\ draft-1*) cp "$5" "` + paramsPath + `"; printf '{"status":"updated"}' ;;
  *) exit 2 ;;
esac
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	requestContext.Request = httptest.NewRequest(http.MethodPatch, "/api/flow360/drafts/draft-1/parameters", strings.NewReader(`{"patch":{"operating_condition":{"alpha":5}}}`))
	requestContext.Request.Header.Set("Content-Type", "application/json")
	app.patchFlow360DraftParameters(requestContext)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected patch response %d: %s", recorder.Code, recorder.Body.String())
	}
	written, _ := os.ReadFile(paramsPath)
	if !strings.Contains(string(written), `"alpha":5`) || !strings.Contains(string(written), `"beta":2`) {
		t.Fatalf("Draft patch did not preserve the baseline: %s", written)
	}
	args, _ := os.ReadFile(argsPath)
	if strings.Contains(string(args), "draft run") {
		t.Fatalf("Draft parameter patch started a run: %s", args)
	}
}

func TestDeleteDraftRequiresConfirmationAndUsesTypedClient(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "flow360")
	script := `#!/bin/sh
printf '%s ' "$@" > "` + argsPath + `"
printf '{"id":"draft-1","deleted":true}'
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}

	unconfirmed := httptest.NewRecorder()
	unconfirmedContext, _ := gin.CreateTestContext(unconfirmed)
	unconfirmedContext.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	unconfirmedContext.Request = httptest.NewRequest(http.MethodDelete, "/api/flow360/drafts/draft-1", nil)
	app.deleteFlow360Draft(unconfirmedContext)
	if unconfirmed.Code != http.StatusBadRequest {
		t.Fatalf("unconfirmed deletion returned %d", unconfirmed.Code)
	}

	confirmed := httptest.NewRecorder()
	confirmedContext, _ := gin.CreateTestContext(confirmed)
	confirmedContext.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	confirmedContext.Request = httptest.NewRequest(http.MethodDelete, "/api/flow360/drafts/draft-1?confirmed=true", nil)
	app.deleteFlow360Draft(confirmedContext)
	if confirmed.Code != http.StatusOK {
		t.Fatalf("confirmed deletion returned %d: %s", confirmed.Code, confirmed.Body.String())
	}
	args, _ := os.ReadFile(argsPath)
	if got := string(args); got != "draft delete draft-1 --yes " {
		t.Fatalf("unexpected Draft delete command: %q", got)
	}
}

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

func TestFolderMutationValidation(t *testing.T) {
	for _, valid := range []string{"folder-1234", "folder-a-b-C-9"} {
		if !validFlow360FolderID(valid, false) {
			t.Errorf("valid Folder ID rejected: %q", valid)
		}
	}
	for _, invalid := range []string{"", flow360RootFolderID, "prj-123", "folder-a/b", "folder-a b"} {
		if validFlow360FolderID(invalid, false) {
			t.Errorf("invalid Folder ID accepted: %q", invalid)
		}
	}
	if !validFlow360FolderID(flow360RootFolderID, true) {
		t.Fatal("root Folder ID was rejected as a parent")
	}
	if got, err := normalizeFlow360FolderName("  Aero studies  "); err != nil || got != "Aero studies" {
		t.Fatalf("unexpected normalized name %q: %v", got, err)
	}
	for _, invalid := range []string{"", "bad\nname", strings.Repeat("a", 129)} {
		if _, err := normalizeFlow360FolderName(invalid); err == nil {
			t.Errorf("invalid Folder name accepted: %q", invalid)
		}
	}
}

func TestDeleteFolderRequiresExplicitConfirmation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "folder_id", Value: "folder-1234"}}
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/flow360/folders/folder-1234", nil)

	(&Server{}).deleteFlow360Folder(context)

	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "confirmed=true") {
		t.Fatalf("unexpected delete response %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestCreateFolderUsesTypedClientAndRefreshesTreeCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "flow360")
	script := `#!/bin/sh
printf '%s ' "$@" >> "` + argsPath + `"
printf '\n' >> "` + argsPath + `"
if [ "$1 $2" = "folder create" ]; then
  printf '{"id":"folder-new","name":"Aero studies","parent_id":"ROOT.FLOW360"}'
else
  printf '{"root":{"id":"ROOT.FLOW360","name":"Workspace","subfolders":[{"id":"folder-new","name":"Aero studies","subfolders":[]}]}}'
fi
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	cache, err := projectcache.New(filepath.Join(dir, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second},
		cache:   cache,
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/folders", strings.NewReader(`{
		"name":" Aero studies ","parent_folder_id":"ROOT.FLOW360","tags":["cfd"]
	}`))
	context.Request.Header.Set("Content-Type", "application/json")

	app.createFlow360Folder(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "folder-new") {
		t.Fatalf("unexpected create response %d: %s", recorder.Code, recorder.Body.String())
	}
	args, _ := os.ReadFile(argsPath)
	if !strings.Contains(string(args), "folder create --name Aero studies --parent-folder-id ROOT.FLOW360 --tag cfd") {
		t.Fatalf("unexpected folder command: %s", args)
	}
	entry, err := cache.Get("folder-tree", "root")
	if err != nil || !strings.Contains(string(entry.Data), "folder-new") {
		t.Fatalf("Folder tree cache was not refreshed: %s, %v", entry.Data, err)
	}
}

func TestProjectMutationValidation(t *testing.T) {
	for _, valid := range []string{"prj-1234", "prj-a-b-C-9"} {
		if !validFlow360ProjectID(valid) {
			t.Errorf("valid Project ID rejected: %q", valid)
		}
	}
	for _, invalid := range []string{"", "project-123", "prj-a/b", "prj-a b"} {
		if validFlow360ProjectID(invalid) {
			t.Errorf("invalid Project ID accepted: %q", invalid)
		}
	}
	if got, err := normalizeFlow360ProjectName("  Aero baseline  "); err != nil || got != "Aero baseline" {
		t.Fatalf("unexpected normalized name %q: %v", got, err)
	}
	for _, invalid := range []string{"", "bad\nname", strings.Repeat("a", 129)} {
		if _, err := normalizeFlow360ProjectName(invalid); err == nil {
			t.Errorf("invalid Project name accepted: %q", invalid)
		}
	}
}

func TestDeleteProjectRequiresExplicitConfirmation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "project_id", Value: "prj-1234"}}
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/flow360/projects/prj-1234", nil)

	(&Server{}).deleteFlow360Project(context)

	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "confirmed=true") {
		t.Fatalf("unexpected delete response %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestProjectMutationErrorMessagesAreActionable(t *testing.T) {
	tests := map[string]string{
		"403 forbidden":          "denied permission",
		"401 unauthorized":       "authentication is required",
		"unexpected remote fail": "refresh the folder and try again",
	}
	for message, expected := range tests {
		if got := flow360ProjectMutationError("delete", errors.New(message)); !strings.Contains(got, expected) {
			t.Errorf("message %q produced %q, want %q", message, got, expected)
		}
	}
}

func TestRenameDraftValidatesAndUsesTypedClient(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := `#!/bin/sh
printf '%s ' "$@" > "` + argsPath + `"
printf '{"id":"draft-1","name":"Cruise baseline"}'
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	requestContext.Request = httptest.NewRequest(http.MethodPut, "/api/flow360/drafts/draft-1/name", strings.NewReader(`{"name":" Cruise baseline "}`))
	requestContext.Request.Header.Set("Content-Type", "application/json")

	app.renameFlow360Draft(requestContext)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"name":"Cruise baseline"`) {
		t.Fatalf("unexpected Draft rename response %d: %s", recorder.Code, recorder.Body.String())
	}
	args, _ := os.ReadFile(argsPath)
	if got := string(args); got != "draft rename draft-1 --name Cruise baseline " {
		t.Fatalf("unexpected Draft rename command: %q", got)
	}
	for _, invalid := range []string{"", "bad\nname", strings.Repeat("a", 129)} {
		if _, err := normalizeFlow360DraftName(invalid); err == nil {
			t.Errorf("invalid Draft name accepted: %q", invalid)
		}
	}
}

func TestDeleteStaleProjectReturnsSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := `#!/bin/sh
printf "Not found error: {'error': 'Item not found.', 'code': '4040000001'}\n" >&2
exit 1
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "project_id", Value: "prj-stale"}}
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/flow360/projects/prj-stale?confirmed=true", nil)

	app.deleteFlow360Project(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"already_absent":true`) {
		t.Fatalf("unexpected stale delete response %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestSubmitPlanToFlow360UpdatesAndRunsPreboundDraft(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	paramsPath := filepath.Join(dir, "params.json")
	binaryPath := filepath.Join(dir, "flow360")
	script := `#!/bin/sh
printf '%s ' "$@" >> "` + argsPath + `"
printf '\n' >> "` + argsPath + `"
case "$1 $2 $3" in
  "draft simulation-params set") cp "$5" "` + paramsPath + `"; printf '{"status":"updated"}' ;;
  "draft simulation-params get") printf '{"version":"canonical"}' ;;
  "draft run draft-ready") printf '{"draft":{"id":"draft-ready","type":"Draft"},"result":{"id":"case-1","type":"Case"}}' ;;
  *) exit 9 ;;
esac
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	plan := plans.Plan{
		SourceID: "geo-1", Target: "case", Name: "AI Create", Baseline: json.RawMessage(`{"version":"base","operating_condition":{"alpha":0}}`),
		Patch: json.RawMessage(`{"operating_condition":{"alpha":5}}`), RemoteIDs: &plans.RemoteIDs{DraftID: "draft-ready"},
	}
	result, err := app.submitPlanToFlow360(context.Background(), plan)
	if err != nil {
		t.Fatal(err)
	}
	if plans.ExtractRemoteIDs(result).CaseID != "case-1" {
		t.Fatalf("unexpected run result: %s", result)
	}
	args, _ := os.ReadFile(argsPath)
	if !strings.Contains(string(args), "draft run draft-ready --up-to case") || strings.Contains(string(args), "--patch") || strings.Contains(string(args), "--name") {
		t.Fatalf("bound Draft run issued wrong commands: %s", args)
	}
	written, _ := os.ReadFile(paramsPath)
	if !strings.Contains(string(written), `"alpha":5`) {
		t.Fatalf("complete parameters were not written before run: %s", written)
	}
}

func TestListInterventionsReturnsEmptyJSONArray(t *testing.T) {
	gin.SetMode(gin.TestMode)
	temp := t.TempDir()
	interventionStore, err := agent.NewInterventionStore(filepath.Join(temp, "interventions"))
	if err != nil {
		t.Fatal(err)
	}
	planStore, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		interventions:      interventionStore,
		interventionEngine: agent.NewEngine(interventionStore, planStore, nil),
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/interventions?project_id=prj-empty", nil)

	app.listInterventions(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	if got := strings.TrimSpace(recorder.Body.String()); got != `{"interventions":[]}` {
		t.Fatalf("got %s, want empty JSON array", got)
	}
}

func TestChatStreamPersistsAndRestoresProjectResourceSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store, err := agent.NewChatStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{agent: &agent.Service{}, chatSessions: store}
	body := `{
  "message":"Why did this case diverge?",
  "project_id":"project-1",
  "resource_id":"case-1",
  "context":"{\"project_id\":\"project-1\",\"source_id\":\"case-1\",\"source_type\":\"Case\",\"source_status\":\"Completed\"}"
}`
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/chat/stream", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.chatStream(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"type":"done"`) {
		t.Fatalf("unexpected stream response %d: %s", recorder.Code, recorder.Body.String())
	}
	session, err := store.Get("project-1", "case-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(session.Messages) != 2 || session.Messages[0].Content != "Why did this case diverge?" {
		t.Fatalf("unexpected persisted transcript: %#v", session)
	}

	getRecorder := httptest.NewRecorder()
	getContext, _ := gin.CreateTestContext(getRecorder)
	getContext.Request = httptest.NewRequest(http.MethodGet, "/api/agent/chat/session?project_id=project-1&resource_id=case-1", nil)
	app.getChatSession(getContext)
	if getRecorder.Code != http.StatusOK || !strings.Contains(getRecorder.Body.String(), "Why did this case diverge?") {
		t.Fatalf("session was not restored: %d %s", getRecorder.Code, getRecorder.Body.String())
	}
}

func TestChatStreamPersistsDraftSeparatelyFromItsSourceResource(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store, err := agent.NewChatStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{agent: &agent.Service{}, chatSessions: store}
	body := `{
  "message":"Change the wall setup.",
  "project_id":"project-1",
  "resource_id":"geo-1",
  "scope_type":"draft",
  "scope_id":"draft-1",
  "context":"{\"project_id\":\"project-1\",\"source_id\":\"geo-1\",\"scope_type\":\"draft\",\"scope_id\":\"draft-1\"}"
}`
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/chat/stream", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.chatStream(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"type":"done"`) {
		t.Fatalf("unexpected stream response %d: %s", recorder.Code, recorder.Body.String())
	}
	draft, err := store.GetScope("project-1", agent.ChatScope{Type: agent.ChatScopeDraft, ID: "draft-1"})
	if err != nil || len(draft.Messages) != 2 {
		t.Fatalf("Draft transcript was not persisted: %#v, %v", draft, err)
	}
	if _, err := store.Get("project-1", "geo-1"); !errors.Is(err, agent.ErrChatSessionNotFound) {
		t.Fatalf("Draft transcript leaked into source Resource scope: %v", err)
	}
}

func TestRecoverPlanCreatesInterventionForPersistedPreflightFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	temp := t.TempDir()
	planStore, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planStore.Create(plans.CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "case", Name: "recover", Intent: "Recover missing inputs.",
		Baseline: json.RawMessage(`{"simulation_params":{}}`), Patch: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	plan, err = planStore.SetPreflight(plan.ID, plans.Preflight{
		Valid: false, ValidatedRevision: plan.Revision,
		Issues:     []plans.PreflightIssue{{Level: "error", Code: "missing", Path: "models", Message: "Field required"}},
		FormSchema: json.RawMessage(`{"type":"object","properties":{"models":{"type":"object"}}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	interventionStore, err := agent.NewInterventionStore(filepath.Join(temp, "interventions"))
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		plans:              planStore,
		interventions:      interventionStore,
		interventionEngine: agent.NewEngine(interventionStore, planStore, nil),
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/plans/"+plan.ID+"/recover", nil)
	context.Params = gin.Params{{Key: "plan_id", Value: plan.ID}}

	app.recoverPlan(context)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	var created agent.Intervention
	if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.PlanID != plan.ID || created.PlanRevision != plan.Revision {
		t.Fatalf("recovery is not bound to the failed plan revision: %#v", created)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		current, err := interventionStore.Get(created.ID)
		if err == nil && current.State == agent.InterventionProposal {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("background recovery did not reach a stable proposal state before test cleanup")
}

func TestCacheableSnapshotRejectsEmptyWorkspaceResponses(t *testing.T) {
	tests := []struct {
		kind string
		raw  json.RawMessage
		want bool
	}{
		{"folder-tree", json.RawMessage(`{"root":{"id":"ROOT.FLOW360","name":"Workspace"}}`), true},
		{"folder-tree", json.RawMessage(`{"root":{}}`), false},
		{"project-list", json.RawMessage(`{"records":[{"id":"prj-1"}]}`), true},
		{"project-list", json.RawMessage(`{"records":[]}`), false},
		{"draft-list", json.RawMessage(`{"records":[]}`), true},
		{"draft-list", json.RawMessage(`{"records":[{"id":"draft-1"}]}`), true},
		{"resource-detail", json.RawMessage(`{"id":"case-1","type":"Case"}`), true},
		{"resource-detail", json.RawMessage(`{"type":"Case"}`), false},
	}
	for _, test := range tests {
		if got := cacheableSnapshot(test.kind, test.raw); got != test.want {
			t.Fatalf("%s %s: got %v, want %v", test.kind, test.raw, got, test.want)
		}
	}
}

func TestWorkspaceRootProjectsReuseAllProjectsCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := json.RawMessage(`{"records":[{"id":"prj-root","name":"Workspace project"}]}`)
	if _, err := cache.Put("project-list", "all", snapshot); err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		cache:   cache,
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/flow360/projects?folder_id=ROOT.FLOW360&cache=only",
		nil,
	)

	app.flow360Projects(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "prj-root") {
		t.Fatalf("workspace root did not reuse all-projects cache: %d %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
}

func TestSweepPatchBuildsNestedMergePatch(t *testing.T) {
	patch := sweepPatch(
		[]comparison.SweepParameter{
			{Name: "operating_condition.alpha.value"},
			{Name: "models.turbulence_model.constants.c1"},
		},
		[]float64{5, 1.2},
	)
	operating := patch["operating_condition"].(map[string]any)
	alpha := operating["alpha"].(map[string]any)
	if alpha["value"] != float64(5) {
		t.Fatalf("unexpected alpha patch: %#v", patch)
	}
	models := patch["models"].(map[string]any)
	turbulence := models["turbulence_model"].(map[string]any)
	constants := turbulence["constants"].(map[string]any)
	if constants["c1"] != 1.2 {
		t.Fatalf("unexpected turbulence patch: %#v", patch)
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

func TestResourceDetailCacheOnlyFallsBackToProjectMirror(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := json.RawMessage(`{"id":"geo-mirrored","type":"Geometry","info":{"status":"processed"}}`)
	if err := mirror.PutResource("prj-1", "Geometry", "geo-mirrored", snapshot); err != nil {
		t.Fatal(err)
	}
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{cache: cache, mirror: mirror}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-mirrored?cache=only", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "geo-mirrored"},
	}

	app.flow360ResourceDetail(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
	if !strings.Contains(recorder.Header().Get("Warning"), "Project mirror") {
		t.Fatalf("unexpected warning %q", recorder.Header().Get("Warning"))
	}
	var body map[string]any
	if json.Unmarshal(recorder.Body.Bytes(), &body) != nil || body["id"] != "geo-mirrored" {
		t.Fatalf("unexpected body %#v", body)
	}
}

func TestGeometryDetailRouteCoexistsWithStaticDiagnosticRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := json.RawMessage(`{"id":"geo-route","type":"Geometry","info":{"status":"processed"}}`)
	if err := mirror.PutResource("prj-route", "Geometry", "geo-route", snapshot); err != nil {
		t.Fatal(err)
	}
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{router: gin.New(), cache: cache, mirror: mirror}
	api := app.router.Group("/api")
	api.GET("/flow360/resources/:resource_type/:resource_id", app.flow360ResourceDetail)
	api.GET("/flow360/resources/Geometry/:resource_id", app.flow360ResourceDetail)
	api.GET("/flow360/resources/Geometry/:resource_id/diagnostics", app.flow360GeometryDiagnostics)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-route?cache=only", nil)
	app.router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("Geometry detail route got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body map[string]any
	if json.Unmarshal(recorder.Body.Bytes(), &body) != nil || body["id"] != "geo-route" {
		t.Fatalf("unexpected Geometry detail %#v", body)
	}
}

func TestCaseDetailStaticRouteUsesCaseTypeAndCacheNamespace(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := json.RawMessage(`{"id":"case-route","type":"Case","info":{"status":"completed"}}`)
	if err := mirror.PutResource("prj-route", "Case", "case-route", snapshot); err != nil {
		t.Fatal(err)
	}
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{router: gin.New(), cache: cache, mirror: mirror}
	api := app.router.Group("/api")
	api.GET("/flow360/resources/:resource_type/:resource_id", app.flow360ResourceDetail)
	api.GET("/flow360/resources/Case/:resource_id", app.flow360ResourceDetail)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Case/case-route?cache=only", nil)
	app.router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("Case detail route got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body map[string]any
	if json.Unmarshal(recorder.Body.Bytes(), &body) != nil || body["type"] != "Case" {
		t.Fatalf("unexpected Case detail %#v", body)
	}
}

func TestResourceDetailCorrectsStaleTypeFromResourceID(t *testing.T) {
	if got := resourceTypeForDetail("Geometry", "case-be9b26d4"); got != "Case" {
		t.Fatalf("got %q, want Case", got)
	}
	if got := resourceTypeForDetail("", "vm-123"); got != "VolumeMesh" {
		t.Fatalf("got %q, want VolumeMesh", got)
	}
	if got := resourceTypeForDetail("SurfaceMesh", "custom-id"); got != "SurfaceMesh" {
		t.Fatalf("got %q, want requested type", got)
	}
}

func TestUpdateDraftParametersRequiresJSONObjectAndReturnsCanonicalParams(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-flow360")
	script := `#!/bin/sh
if [ "$3" = "set" ]; then
  printf '{"status":"updated"}'
else
  printf '{"version":"canonical","meshing":{"defaults":{"target_surface_node_count":1000000}}}'
fi
`
	if err := os.WriteFile(binaryPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/flow360/drafts/draft-1/parameters", strings.NewReader(`{"simulation_params":{"version":"draft"}}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	app.updateFlow360DraftParameters(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"version":"canonical"`) {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	context, _ = gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/flow360/drafts/draft-1/parameters", strings.NewReader(`{"simulation_params":[]}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	app.updateFlow360DraftParameters(context)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("array payload got %d, want 400", recorder.Code)
	}
}

func TestValidateDraftParametersFiltersExpressionIssuesWithoutWritingDraft(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	binaryPath := filepath.Join(dir, "fake-flow360")
	binaryScript := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$*" >> %q
case "$1 $2" in
  "draft info") printf '{"source_type":"Geometry"}' ;;
  "draft state") printf '{"state":"draft"}' ;;
  "draft simulation-params") printf '{"unit_system":{"name":"SI"}}' ;;
esac
`, argsPath)
	if err := os.WriteFile(binaryPath, []byte(binaryScript), 0o700); err != nil {
		t.Fatal(err)
	}
	pythonPath := filepath.Join(dir, "python")
	pythonScript := `#!/bin/sh
printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"value_error","path":"time_stepping.step_size","message":"Dimension mismatch","stages":["Case"]},{"level":"error","code":"missing","path":"models","message":"Models required","stages":["Case"]}],"form_schema":{"type":"object","properties":{}}}'
`
	if err := os.WriteFile(pythonPath, []byte(pythonScript), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", pythonPath)
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/drafts/draft-1/parameters/validate", strings.NewReader(`{
		"simulation_params":{"time_stepping":{"step_size":{"type_name":"expression","expression":"1 * u.m"}}},
		"paths":["time_stepping.step_size"]
	}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	app.validateFlow360DraftParameters(context)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"valid":false`) || strings.Contains(recorder.Body.String(), "Models required") {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}
	args, _ := os.ReadFile(argsPath)
	if strings.Contains(string(args), "simulation-params set") {
		t.Fatalf("validation mutated the Draft: %s", args)
	}
}

func TestValidateDraftParametersReturnsCompletePreflightWhenPathsAreOmitted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-flow360")
	binaryScript := `#!/bin/sh
case "$1 $2" in
  "draft info") printf '{"source_type":"Geometry"}' ;;
  "draft state") printf '{"state":"draft"}' ;;
  "draft simulation-params") printf '{"unit_system":{"name":"SI"}}' ;;
esac
`
	if err := os.WriteFile(binaryPath, []byte(binaryScript), 0o700); err != nil {
		t.Fatal(err)
	}
	pythonPath := filepath.Join(dir, "python")
	pythonScript := `#!/bin/sh
printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"missing","path":"models","message":"Models required","stages":["Case"]},{"level":"warning","code":"output","path":"outputs","message":"No outputs configured","stages":["Case"]}],"form_schema":{"type":"object","properties":{}}}'
`
	if err := os.WriteFile(pythonPath, []byte(pythonScript), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", pythonPath)
	app := &Server{flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/drafts/draft-1/parameters/validate", strings.NewReader(`{
		"simulation_params":{"unit_system":{"name":"SI"}},
		"paths":[]
	}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "draft_id", Value: "draft-1"}}
	app.validateFlow360DraftParameters(context)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "Models required") || !strings.Contains(recorder.Body.String(), "No outputs configured") {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestDraftSourceTypeNormalizesMetadataAndFallsBackToGeometry(t *testing.T) {
	if got := draftSourceType(json.RawMessage(`{"source_type":"surface-mesh"}`)); got != "SurfaceMesh" {
		t.Fatalf("got %q, want SurfaceMesh", got)
	}
	if got := draftSourceType(json.RawMessage(`{"name":"legacy"}`)); got != "Geometry" {
		t.Fatalf("got %q, want Geometry fallback", got)
	}
}

func TestDraftReviewIdempotencyTracksRemoteBaseline(t *testing.T) {
	first := draftReviewIdempotencyKey("draft-1", "case", json.RawMessage(`{"alpha":0}`), json.RawMessage(`{}`))
	repeated := draftReviewIdempotencyKey("draft-1", "case", json.RawMessage(`{"alpha":0}`), json.RawMessage(`{}`))
	updated := draftReviewIdempotencyKey("draft-1", "case", json.RawMessage(`{"alpha":5}`), json.RawMessage(`{}`))
	if first != repeated {
		t.Fatalf("same remote Draft baseline produced different review keys: %q != %q", first, repeated)
	}
	if first == updated {
		t.Fatalf("updated remote Draft baseline reused stale review key %q", first)
	}
}

// TestProjectInfoCacheOnlyReturnsSnapshotWithoutCallingFlow360 ensures that
// the `?cache=only` flag serves stale snapshots when the live CLI is
// broken — one of the core restart-recovery paths from lf5.10.
func TestProjectInfoCacheOnlyReturnsSnapshotWithoutCallingFlow360(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const projectID = "proj-42"
	snapshot := json.RawMessage(`{"id":"proj-42","name":"Wing Test","solver_version":"2024R1","tags":["baseline"],"root_item":{"id":"geo-1","type":"Geometry"}}`)
	if _, err := cache.Put("project-info", projectID, snapshot); err != nil {
		t.Fatal(err)
	}

	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		cache:   cache,
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/projects/proj-42?cache=only", nil)
	context.Params = gin.Params{{Key: "project_id", Value: projectID}}

	app.flow360ProjectInfo(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
	var got map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["id"] != "proj-42" {
		t.Fatalf("got id %v, want proj-42", got["id"])
	}
}

// TestResourceDetailInvalidKeyReturns404 verifies that unknown
// resource ids return a 404-style error instead of leaking as a 500,
// which is the regression targeted at AC (invalid key) handling.
func TestResourceDetailInvalidKeyReturns404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		cache:   cache,
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/unknown-id", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "unknown-id"},
	}

	app.flow360ResourceDetail(context)

	if recorder.Code == http.StatusOK {
		t.Fatalf("got status 200, want non-200 for an unknown resource id")
	}
}

// TestProjectTreePartialErrorFallsBackToCache documents the case where
// the live flow360 CLI returns a partial response but the Go cache has
// the full tree on disk — the API must not surface the partial payload.
func TestProjectTreePartialErrorFallsBackToCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const projectID = "proj-50"
	snapshot := json.RawMessage(`{"root":{"id":"geo-0","name":"Geometry 0","type":"Geometry","children":[{"id":"sm-0","name":"SurfaceMesh 0","type":"SurfaceMesh","children":[]}]}}`)
	if _, err := cache.Put("project-tree", projectID, snapshot); err != nil {
		t.Fatal(err)
	}

	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		cache:   cache,
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/projects/proj-50/tree", nil)
	context.Params = gin.Params{{Key: "project_id", Value: projectID}}

	app.flow360ProjectTree(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("X-VibeSim-Data-Source"); got != "cache" {
		t.Fatalf("got data source %q, want cache", got)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	root, ok := body["root"].(map[string]any)
	if !ok {
		t.Fatalf("expected root object, got %T", body["root"])
	}
	if root["id"] != "geo-0" {
		t.Fatalf("got root id %v, want geo-0", root["id"])
	}
}

func TestPlanFromActionCreatesPlans(t *testing.T) {
	planStore, err := plans.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		plans:   planStore,
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	action := agent.Action{
		Version: agent.ActionVersion,
		Kind:    agent.ActionCreatePlan,
		Message: "Create test plans",
		Proposals: []agent.Proposal{
			{
				ID:         "p1",
				ProjectID:  "prj-1",
				SourceID:   "src-1",
				SourceType: "VolumeMesh",
				Target:     "case",
				Name:       "Test Case",
				Intent:     "Test",
				Patch:      json.RawMessage(`{"alpha":5}`),
				Fields: []agent.Field{{
					Key: "alpha", Value: 5, Provenance: agent.ProvenanceProvided, Description: "User input",
				}},
				ValidationHints: []string{"Validate alpha"},
			},
		},
	}
	body, _ := json.Marshal(actionPlanRequest{Action: action})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/plan-from-action", bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.planFromAction(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", recorder.Code)
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["created"].(float64) != 1 {
		t.Fatalf("expected 1 created, got %v", response["created"])
	}
	results := response["results"].([]any)
	plan := results[0].(map[string]any)["plan"].(map[string]any)
	if len(plan["evidence"].([]any)) != 1 || len(plan["validation_hints"].([]any)) != 1 {
		t.Fatalf("expected proposal evidence and validation hints, got %#v", plan)
	}
}

func TestPlanFromActionRejectsNonCreatePlanKind(t *testing.T) {
	planStore, err := plans.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		plans:   planStore,
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	action := agent.Action{
		Version: agent.ActionVersion,
		Kind:    agent.ActionRequestMissingInput,
		Message: "Need more info",
	}
	body, _ := json.Marshal(actionPlanRequest{Action: action})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/plan-from-action", bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.planFromAction(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestPlanFromActionUsesRequestContextAndIsIdempotent(t *testing.T) {
	planStore, err := plans.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{plans: planStore}
	action := agent.Action{
		Version: agent.ActionVersion,
		Kind:    agent.ActionCreatePlan,
		Message: "Create a contextual plan",
		Proposals: []agent.Proposal{{
			ID: "context-plan", SourceType: "VolumeMesh", Target: "case",
			Name: "Context Case", Intent: "Review locally", Patch: json.RawMessage(`{}`),
		}},
	}
	request := actionPlanRequest{
		Action: action, ProjectID: "project-context", ProjectName: "Context Project",
		SourceID: "vm-context", SourceType: "VolumeMesh", SourceName: "Context Mesh",
	}
	body, _ := json.Marshal(request)

	var planIDs []string
	for attempt := 0; attempt < 2; attempt++ {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/plan-from-action", bytes.NewReader(body))
		context.Request.Header.Set("Content-Type", "application/json")
		app.planFromAction(context)
		if recorder.Code != http.StatusOK {
			t.Fatalf("attempt %d returned status %d: %s", attempt+1, recorder.Code, recorder.Body.String())
		}
		var response struct {
			Results []struct {
				Plan plans.Plan `json:"plan"`
			} `json:"results"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if len(response.Results) != 1 {
			t.Fatalf("expected one result, got %#v", response.Results)
		}
		plan := response.Results[0].Plan
		if plan.ProjectID != request.ProjectID || plan.SourceID != request.SourceID || plan.SourceName != request.SourceName {
			t.Fatalf("request context was not applied: %#v", plan)
		}
		planIDs = append(planIDs, plan.ID)
	}
	if planIDs[0] != planIDs[1] {
		t.Fatalf("repeated conversion created duplicate plans: %v", planIDs)
	}
}

func TestPlanPreflightBlocksApprovalAndAcceptsSchemaFormInputs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	fakeResult := `#!/bin/sh
printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"missing","path":"meshing.defaults.length","message":"Field required","stages":["SurfaceMesh"]}],"form_schema":{"type":"object","required":["meshing"],"properties":{"meshing":{"type":"object","required":["defaults"],"properties":{"defaults":{"type":"object","required":["length"],"properties":{"length":{"type":"quantity","unit":"meter","value_schema":{"type":"number","exclusiveMinimum":0},"required":true}}}}}}}}'
`
	if err := os.WriteFile(fakePython, []byte(fakeResult), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)
	store, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(plans.CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "surface-mesh", Name: "mesh", Intent: "Build a surface mesh.",
		Baseline: json.RawMessage(`{"simulation_params":{"version":"test","meshing":{"defaults":{}}}}`),
		Patch:    json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{
		plans: store,
		flow360: &flow360.Client{
			Binary: "flow360",
		},
	}

	preflightRecorder := httptest.NewRecorder()
	preflightContext, _ := gin.CreateTestContext(preflightRecorder)
	preflightContext.Request = httptest.NewRequest(http.MethodPost, "/api/plans/"+created.ID+"/preflight", nil)
	preflightContext.Params = gin.Params{{Key: "plan_id", Value: created.ID}}
	app.preflightPlan(preflightContext)
	if preflightRecorder.Code != http.StatusOK {
		t.Fatalf("preflight status %d: %s", preflightRecorder.Code, preflightRecorder.Body)
	}
	var preflighted plans.Plan
	if err := json.Unmarshal(preflightRecorder.Body.Bytes(), &preflighted); err != nil {
		t.Fatal(err)
	}
	if preflighted.Preflight == nil || preflighted.Preflight.Valid || preflighted.Revision != 1 {
		t.Fatalf("unexpected preflight plan %#v", preflighted)
	}

	approvalRecorder := httptest.NewRecorder()
	approvalContext, _ := gin.CreateTestContext(approvalRecorder)
	approvalContext.Request = httptest.NewRequest(http.MethodPost, "/api/plans/"+created.ID+"/approve", nil)
	approvalContext.Params = gin.Params{{Key: "plan_id", Value: created.ID}}
	app.approvePlan(approvalContext)
	if approvalRecorder.Code != http.StatusConflict {
		t.Fatalf("invalid preflight approval got %d, want 409", approvalRecorder.Code)
	}

	inputBody := bytes.NewBufferString(`{"revision":1,"values":{"meshing":{"defaults":{"length":{"value":0.01,"units":"m"}}}}}`)
	inputRecorder := httptest.NewRecorder()
	inputContext, _ := gin.CreateTestContext(inputRecorder)
	inputContext.Request = httptest.NewRequest(http.MethodPost, "/api/plans/"+created.ID+"/inputs", inputBody)
	inputContext.Request.Header.Set("Content-Type", "application/json")
	inputContext.Params = gin.Params{{Key: "plan_id", Value: created.ID}}
	app.applyPlanInputs(inputContext)
	if inputRecorder.Code != http.StatusOK {
		t.Fatalf("input status %d: %s", inputRecorder.Code, inputRecorder.Body)
	}
	var updated plans.Plan
	if err := json.Unmarshal(inputRecorder.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || !strings.Contains(string(updated.Patch), `"length"`) {
		t.Fatalf("dynamic input was not merged: %#v", updated)
	}
}

func TestUpdatePlanParametersAppliesPublicMergePatchAndRevalidates(t *testing.T) {
	gin.SetMode(gin.TestMode)
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	fakeResult := `#!/bin/sh
if grep -q '"value":0.02' "$3"; then
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{}}}'
else
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"invalid","path":"meshing.defaults.length","message":"Use 0.02","stages":["SurfaceMesh"]}],"form_schema":{"type":"object","properties":{}}}'
fi
`
	if err := os.WriteFile(fakePython, []byte(fakeResult), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)
	store, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(plans.CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry", Target: "surface-mesh",
		Name: "mesh", Intent: "Build a surface mesh.",
		Baseline: json.RawMessage(`{"simulation_params":{"version":"test","meshing":{"defaults":{"length":{"value":0.01,"units":"m"}}}}}`),
		Patch:    json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{plans: store, flow360: &flow360.Client{Binary: "flow360"}}
	body := bytes.NewBufferString(`{"revision":1,"values":{"meshing":{"defaults":{"length":{"value":0.02,"units":"m"}}}}}`)
	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Request = httptest.NewRequest(http.MethodPut, "/api/plans/"+created.ID+"/parameters", body)
	requestContext.Request.Header.Set("Content-Type", "application/json")
	requestContext.Params = gin.Params{{Key: "plan_id", Value: created.ID}}
	app.updatePlanParameters(requestContext)
	if recorder.Code != http.StatusOK {
		t.Fatalf("update status %d: %s", recorder.Code, recorder.Body)
	}
	var updated plans.Plan
	if err := json.Unmarshal(recorder.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || updated.Preflight == nil || !updated.Preflight.Valid {
		t.Fatalf("parameter update was not revalidated: %#v", updated)
	}
}

func TestPlanPreflightAutomaticallyAppliesHighConfidenceBoundaryRepair(t *testing.T) {
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	fakeResult := `#!/bin/sh
if grep -q '"type":"SymmetryPlane"' "$3"; then
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{},"required":[]}}'
else
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"value_error","path":"models","message":"The following boundaries do not have a boundary condition: symmetric.","stages":["Case"]}],"form_schema":{"type":"object","required":["models"],"properties":{"models":{"type":"entity_assignment","model_choices":[{"value":"new:SymmetryPlane","label":"New SymmetryPlane","model_type":"SymmetryPlane","entity_property":"surfaces"}],"entity_choices":[{"value":"symmetric","label":"symmetric","payload":{"name":"symmetric","private_attribute_id":"symmetric","private_attribute_entity_type_name":"GhostCircularPlane"}}],"default_model":"new:SymmetryPlane","default_entities":["symmetric"],"recommendation":{"confidence":"high","provenance":"flow360_schema_validation"}}}}}'
fi
`
	if err := os.WriteFile(fakePython, []byte(fakeResult), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)
	store, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(plans.CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "case", Name: "cylinder", Intent: "Run a cylinder case.",
		Baseline: json.RawMessage(`{"simulation_params":{"version":"test","models":[{"type":"Wall","name":"Wall","surfaces":{"stored_entities":[{"name":"cylinder"}]}},{"type":"Fluid"}]}}`),
		Patch:    json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{plans: store, flow360: &flow360.Client{Binary: "flow360"}}

	updated := app.runPlanPreflight(context.Background(), created)
	if updated.Preflight == nil || !updated.Preflight.Valid {
		t.Fatalf("high-confidence schema repair did not clear preflight: %#v", updated.Preflight)
	}
	if updated.Revision != 2 {
		t.Fatalf("automatic repair should create one reviewed revision, got %d", updated.Revision)
	}
	merged, err := plans.MergedSimulationParams(updated)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(merged), `"type":"SymmetryPlane"`) || !strings.Contains(string(merged), `"name":"symmetric"`) {
		t.Fatalf("automatic boundary repair was not persisted: %s", merged)
	}
}

func TestValidateAndApplyInterventionPersistsPatchAndRealPreflight(t *testing.T) {
	temp := t.TempDir()
	fakePython := filepath.Join(temp, "python")
	fakeResult := `#!/bin/sh
if grep -q '"value":0.01' "$3"; then
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":true,"issues":[],"form_schema":{"type":"object","properties":{},"required":[]}}'
else
  printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"missing","path":"meshing.defaults.length","message":"Field required","stages":["SurfaceMesh"]}],"form_schema":{"type":"object","required":["meshing"],"properties":{"meshing":{"type":"object","required":["defaults"],"properties":{"defaults":{"type":"object","required":["length"],"properties":{"length":{"type":"quantity","unit":"m","value_schema":{"type":"number","exclusiveMinimum":0},"required":true}}}}}}}}'
fi
`
	if err := os.WriteFile(fakePython, []byte(fakeResult), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fakePython)

	planStore, err := plans.NewStore(filepath.Join(temp, "plans"))
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planStore.Create(plans.CreateInput{
		ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "surface-mesh", Name: "mesh", Intent: "Build a surface mesh.",
		Baseline: json.RawMessage(`{"simulation_params":{"version":"test","meshing":{"defaults":{}}}}`),
		Patch:    json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	flowClient := &flow360.Client{Binary: "flow360"}
	preflight, err := flowClient.PreflightSimulationParams(
		context.Background(),
		plan.SourceType,
		plan.Target,
		json.RawMessage(`{"simulation_params":{"version":"test","meshing":{"defaults":{}}}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	issues := make([]plans.PreflightIssue, 0, len(preflight.Issues))
	for _, issue := range preflight.Issues {
		issues = append(issues, plans.PreflightIssue{
			Level: issue.Level, Code: issue.Code, Path: issue.Path,
			Message: issue.Message, Stages: issue.Stages,
		})
	}
	plan, err = planStore.SetPreflight(plan.ID, plans.Preflight{
		SchemaVersion: preflight.SchemaVersion, ValidatorVersion: preflight.ValidatorVersion,
		Valid: preflight.Valid, ValidatedRevision: plan.Revision,
		Issues: issues, FormSchema: preflight.FormSchema,
	})
	if err != nil {
		t.Fatal(err)
	}

	interventionStore, err := agent.NewInterventionStore(filepath.Join(temp, "interventions"))
	if err != nil {
		t.Fatal(err)
	}
	engine := agent.NewEngine(interventionStore, planStore, nil)
	intervention, err := agent.NewIntervention(agent.InterventionInput{
		ProjectID: "prj-1", ResourceID: "geo-1", ResourceType: "Geometry",
		PlanID: plan.ID, PlanRevision: plan.Revision, Type: agent.TypePreflightError,
		Reason: "Field required", CurrentPatch: plan.Patch,
	})
	if err != nil {
		t.Fatal(err)
	}
	intervention.State = agent.InterventionValidation
	intervention.SelectedProposal = &agent.Proposal{ID: "schema", Name: "schema"}
	intervention.CompiledPatch = json.RawMessage(
		`{"meshing":{"defaults":{"length":{"value":0.01,"units":"m"}}}}`,
	)
	if _, err := interventionStore.Create(intervention); err != nil {
		t.Fatal(err)
	}

	app := &Server{
		plans: planStore, flow360: flowClient,
		interventions: interventionStore, interventionEngine: engine,
	}
	resolved, err := app.validateAndApplyIntervention(intervention.ID)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.State != agent.InterventionResolved || resolved.PlanRevision != 2 {
		t.Fatalf("intervention did not resolve against the new revision: %#v", resolved)
	}
	updated, err := planStore.Get(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || !strings.Contains(string(updated.Patch), `"length"`) {
		t.Fatalf("compiled intervention patch was not persisted: %#v", updated)
	}
	if updated.Preflight == nil || !updated.Preflight.Valid ||
		updated.Preflight.ValidatedRevision != updated.Revision {
		t.Fatalf("new plan revision did not pass real preflight: %#v", updated.Preflight)
	}
}

func TestDeterministicRemoteRecoveryCanAutoAdvance(t *testing.T) {
	proposal := agent.Proposal{ID: "periodic-node-mismatch-symmetry", Patch: json.RawMessage(`{"models":[]}`)}
	selected, ok := autoApplicableRecoveryProposal(agent.Intervention{Proposals: []agent.Proposal{proposal}})
	if !ok || selected.ID != proposal.ID {
		t.Fatal("schema-validated periodic mismatch repair should auto-advance locally")
	}
	if _, ok := autoApplicableRecoveryProposal(agent.Intervention{Proposals: []agent.Proposal{{ID: "manual"}}}); ok {
		t.Fatal("ambiguous recovery proposal must remain review-only")
	}
}

func TestSelectRecoveryProposalIsIdempotentAfterAutomaticClose(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store, err := agent.NewInterventionStore(filepath.Join(t.TempDir(), "interventions"))
	if err != nil {
		t.Fatal(err)
	}
	intervention, err := agent.NewIntervention(agent.InterventionInput{
		ProjectID: "prj-1", PlanID: "plan-1", Type: agent.TypeRemoteError, Reason: "remote failure",
	})
	if err != nil {
		t.Fatal(err)
	}
	intervention.Proposals = []agent.Proposal{{ID: "repair-1", Name: "repair"}}
	intervention.Validation = &agent.ValidationResult{Valid: true}
	if err := intervention.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(intervention); err != nil {
		t.Fatal(err)
	}
	app := &Server{interventions: store, interventionEngine: agent.NewEngine(store, nil, nil)}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/interventions/"+intervention.ID+"/select", bytes.NewBufferString(`{"proposal_id":"repair-1"}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "intervention_id", Value: intervention.ID}}

	app.selectInterventionProposal(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"state":"closed"`) {
		t.Fatalf("a stale proposal click should return the completed recovery, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestEmptyPreflightSchemaDoesNotConsumeCompiledPatchAsFormValues(t *testing.T) {
	if schemaHasEditableProperties(json.RawMessage(`{"type":"object","properties":{}}`)) {
		t.Fatal("empty preflight schema must not discard a compiled SimulationParams patch")
	}
	if !schemaHasEditableProperties(json.RawMessage(`{"type":"object","properties":{"models":{"type":"entity_assignment"}}}`)) {
		t.Fatal("schema-backed recovery form should use form expansion")
	}
}

func TestPublicExecutionErrorDoesNotExposeTraceback(t *testing.T) {
	got := publicExecutionError(errors.New("Traceback /Users/private/source Fail to generate simulation config"))
	if strings.Contains(got.Error(), "Traceback") || strings.Contains(got.Error(), "/Users/") {
		t.Fatalf("private traceback leaked: %v", got)
	}
	if !strings.Contains(strings.ToLower(got.Error()), "validation") {
		t.Fatalf("validation action was lost: %v", got)
	}
}

func TestPlanMonitorTargetUsesReturnedResourceType(t *testing.T) {
	tests := []struct {
		name     string
		plan     plans.Plan
		wantType string
		wantID   string
		wantOK   bool
	}{
		{
			name: "geometry to case monitors case",
			plan: plans.Plan{
				SourceType: "Geometry", Target: "case",
				RemoteIDs: &plans.RemoteIDs{CaseID: "case-1"},
			},
			wantType: "Case", wantID: "case-1", wantOK: true,
		},
		{
			name: "surface mesh target",
			plan: plans.Plan{
				SourceType: "Geometry", Target: "surface-mesh",
				RemoteIDs: &plans.RemoteIDs{MeshID: "sm-1"},
			},
			wantType: "SurfaceMesh", wantID: "sm-1", wantOK: true,
		},
		{
			name: "volume mesh target",
			plan: plans.Plan{
				SourceType: "SurfaceMesh", Target: "volume-mesh",
				RemoteIDs: &plans.RemoteIDs{MeshID: "vm-1"},
			},
			wantType: "VolumeMesh", wantID: "vm-1", wantOK: true,
		},
		{
			name: "draft fallback",
			plan: plans.Plan{
				Target: "case", RemoteIDs: &plans.RemoteIDs{DraftID: "dft-1"},
			},
			wantType: "Draft", wantID: "dft-1", wantOK: true,
		},
		{
			name: "recovers nested legacy result",
			plan: plans.Plan{
				Target: "case",
				Result: json.RawMessage(`{"draft":{"id":"dft-1","type":"Draft"},"result":{"id":"case-1","type":"Case"}}`),
			},
			wantType: "Case", wantID: "case-1", wantOK: true,
		},
		{name: "missing IDs", plan: plans.Plan{}, wantOK: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resourceType, resourceID, ok := planMonitorTarget(test.plan)
			if resourceType != test.wantType || resourceID != test.wantID || ok != test.wantOK {
				t.Fatalf("got (%q, %q, %v), want (%q, %q, %v)",
					resourceType, resourceID, ok, test.wantType, test.wantID, test.wantOK)
			}
		})
	}
}

func TestNormalizeImportResultRequiresProjectAndRootResourceIDs(t *testing.T) {
	raw := json.RawMessage(`{
		"record":{"project_id":"prj-1"},
		"resources":[{"id":"geo-1","type":"Geometry"}]
	}`)
	result, err := normalizeImportResult(raw, "geometry")
	if err != nil {
		t.Fatal(err)
	}
	var normalized map[string]any
	if err := json.Unmarshal(result, &normalized); err != nil {
		t.Fatal(err)
	}
	if normalized["project_id"] != "prj-1" ||
		normalized["root_resource_id"] != "geo-1" ||
		normalized["root_resource_type"] != "geometry" {
		t.Fatalf("unexpected normalized import result: %#v", normalized)
	}

	if _, err := normalizeImportResult(
		json.RawMessage(`{"project_id":"prj-1"}`),
		"geometry",
	); err == nil || !strings.Contains(err.Error(), "root resource") {
		t.Fatalf("missing root resource ID was accepted: %v", err)
	}
	if _, err := normalizeImportResult(
		json.RawMessage(`{"geometry_id":"geo-1"}`),
		"geometry",
	); err == nil || !strings.Contains(err.Error(), "Project ID") {
		t.Fatalf("missing Project ID was accepted: %v", err)
	}
}

func TestApplyPlanInputsRejectsOversizedBody(t *testing.T) {
	app := &Server{}
	body := bytes.NewBufferString(`{"revision":1,"values":{"field":"` +
		strings.Repeat("x", maxPlanInputsRequestBytes) + `"}}`)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/plans/plan-1/inputs", body)
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "plan_id", Value: "plan-1"}}

	app.applyPlanInputs(context)

	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized input got %d, want 413: %s", recorder.Code, recorder.Body)
	}
}

func TestResourceMeshPreviewRejectsPathTraversal(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/../etc/passwd/preview-mesh", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "../etc/passwd"},
	}

	app.flow360ResourceMeshPreview(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestResourceMeshPreviewRejectsUnsupportedType(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/UnknownType/id/preview-mesh", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "UnknownType"},
		{Key: "resource_id", Value: "id"},
	}

	app.flow360ResourceMeshPreview(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestGeometryMeshPreviewUsesLocalUVFManifest(t *testing.T) {
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[
		{
			"id":"body-1",
			"type":"SolidGeometry",
			"properties":{"boundsMin":[-1,-1,-1],"boundsMax":[1,1,1]},
			"resources":{"buffers":{"type":"buffers","path":"body.bin","sections":[
				{"name":"position","length":36}
			]}}
		},
		{
			"id":"face-1",
			"name":"Face 1",
			"type":"Face",
			"properties":{"bufferLocations":{"indices":[
				{"startIndex":0,"endIndex":3}
			]}}
		}
	]`)
	if _, err := mirror.PutGeometryVisualization(
		"prj-1",
		"geo-1",
		manifest,
		map[string][]byte{"body.bin": make([]byte, 36)},
	); err != nil {
		t.Fatal(err)
	}
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
		mirror:  mirror,
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/preview-mesh", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "geo-1"},
	}
	app.flow360ResourceMeshPreview(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
	var preview flow360.MeshPreview
	if err := json.Unmarshal(recorder.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Format != "flow360-uvf" || len(preview.Groups) != 1 {
		t.Fatalf("unexpected preview %#v", preview)
	}
}

func TestGeometryDiagnosticsUsesSynchronizedManifestEvidence(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[
		{"id":"solid","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[1,2,3]},"resources":{"buffers":{"type":"buffers","path":"mesh.bin","sections":[{"name":"position","length":144}]}}},
		{"id":"body00001_face_0","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}},
		{"id":"body00001_face_1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":3,"endIndex":33}]}}}
	]`)
	if _, err := mirror.PutGeometryVisualization("prj-1", "geo-1", manifest, map[string][]byte{"mesh.bin": {0, 1, 2}}); err != nil {
		t.Fatal(err)
	}
	app := &Server{mirror: mirror}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/diagnostics?small_surface_ratio=0.2", nil)
	context.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}}

	app.flow360GeometryDiagnostics(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Fingerprint  string `json:"fingerprint"`
		Capabilities []struct {
			Key    string `json:"key"`
			Status string `json:"status"`
		} `json:"capabilities"`
		Findings []struct {
			EntityIDs []string `json:"entity_ids"`
		} `json:"findings"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	smallFeatureStatus := ""
	for _, capability := range response.Capabilities {
		if capability.Key == "small-features" {
			smallFeatureStatus = capability.Status
		}
	}
	if response.Fingerprint == "" || smallFeatureStatus != "proxy" || len(response.Findings[0].EntityIDs) != 1 {
		t.Fatalf("unexpected diagnostic response: %#v", response)
	}
	if got := recorder.Header().Get("X-Geometry-Diagnostics-Cache"); got != "MISS" {
		t.Fatalf("first diagnostic request cache status = %q", got)
	}
	secondRecorder := httptest.NewRecorder()
	secondContext, _ := gin.CreateTestContext(secondRecorder)
	secondContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/diagnostics?small_surface_ratio=0.2", nil)
	secondContext.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}}
	app.flow360GeometryDiagnostics(secondContext)
	if secondRecorder.Code != http.StatusOK || secondRecorder.Header().Get("X-Geometry-Diagnostics-Cache") != "HIT" {
		t.Fatalf("cached diagnostics got %d, cache %q", secondRecorder.Code, secondRecorder.Header().Get("X-Geometry-Diagnostics-Cache"))
	}
	thirdRecorder := httptest.NewRecorder()
	thirdContext, _ := gin.CreateTestContext(thirdRecorder)
	thirdContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/diagnostics?small_surface_ratio=0.2&curvature_angle_deg=45", nil)
	thirdContext.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}}
	app.flow360GeometryDiagnostics(thirdContext)
	if thirdRecorder.Code != http.StatusOK || thirdRecorder.Header().Get("X-Geometry-Diagnostics-Cache") != "MISS" {
		t.Fatalf("changed-threshold diagnostics got %d, cache %q", thirdRecorder.Code, thirdRecorder.Header().Get("X-Geometry-Diagnostics-Cache"))
	}
}

func TestGeometryDiagnosticsJobCompletesAndCanBeRead(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	manifest := json.RawMessage(`[
		{"id":"solid","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[1,2,3]},"resources":{"buffers":{"type":"buffers","path":"mesh.bin","sections":[{"name":"position","length":36}]}}},
		{"id":"face-1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}}
	]`)
	if _, err := mirror.PutGeometryVisualization("prj-1", "geo-1", manifest, map[string][]byte{"mesh.bin": make([]byte, 36)}); err != nil {
		t.Fatal(err)
	}
	jobRoot := t.TempDir()
	jobs, err := geometrydiag.NewJobStore(jobRoot)
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{mirror: mirror, geometryJobs: jobs, geometryJobSlots: make(chan struct{}, 1)}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/resources/Geometry/geo-1/diagnostics/jobs", bytes.NewBufferString(`{"small_surface_ratio":0.1,"curvature_angle_deg":30}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}}

	app.startGeometryDiagnosticsJob(context)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}
	var started geometrydiag.Job
	if err := json.Unmarshal(recorder.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	var completed geometrydiag.Job
	for time.Now().Before(deadline) {
		completed, _ = jobs.Get(started.ID)
		if completed.Status == geometrydiag.JobCompleted {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if completed.Status != geometrydiag.JobCompleted || completed.Report == nil || completed.Progress != 100 {
		t.Fatalf("unexpected completed job: %#v", completed)
	}

	getRecorder := httptest.NewRecorder()
	getContext, _ := gin.CreateTestContext(getRecorder)
	getContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/diagnostics/jobs/"+started.ID, nil)
	getContext.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}, {Key: "job_id", Value: started.ID}}
	app.getGeometryDiagnosticsJob(getContext)
	if getRecorder.Code != http.StatusOK || !strings.Contains(getRecorder.Body.String(), `"status":"completed"`) {
		t.Fatalf("got %d: %s", getRecorder.Code, getRecorder.Body.String())
	}
	latestRecorder := httptest.NewRecorder()
	latestContext, _ := gin.CreateTestContext(latestRecorder)
	latestContext.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/diagnostics/jobs/latest", nil)
	latestContext.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}}
	app.latestGeometryDiagnosticsJob(latestContext)
	if latestRecorder.Code != http.StatusOK || !strings.Contains(latestRecorder.Body.String(), started.ID) {
		t.Fatalf("latest job got %d: %s", latestRecorder.Code, latestRecorder.Body.String())
	}

	reopened, err := geometrydiag.NewJobStore(jobRoot)
	if err != nil {
		t.Fatal(err)
	}
	persisted, ok := reopened.Get(started.ID)
	if !ok || persisted.Status != geometrydiag.JobCompleted || persisted.Report == nil {
		t.Fatalf("job did not survive store restart: %#v", persisted)
	}
}

func TestGeometryComparisonRejectsSameResource(t *testing.T) {
	gin.SetMode(gin.TestMode)
	app := &Server{}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/geo-1/compare/geo-1", nil)
	context.Params = gin.Params{{Key: "resource_id", Value: "geo-1"}, {Key: "compare_id", Value: "geo-1"}}

	app.flow360GeometryComparison(context)

	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "different Geometry") {
		t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestGeometryVisualizationAssetServesOnlyManifestAndBins(t *testing.T) {
	mirror, err := projectmirror.New(t.TempDir(), "production-default")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mirror.PutGeometryVisualization(
		"prj-1",
		"geo-1",
		json.RawMessage(`[{"id":"body","type":"SolidGeometry","resources":{"buffers":{"type":"buffers","path":"nested/body.bin","sections":[{"name":"position","length":36}]}}}]`),
		map[string][]byte{"nested/body.bin": {1, 2, 3}},
	); err != nil {
		t.Fatal(err)
	}
	app := &Server{mirror: mirror}
	call := func(path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/asset", nil)
		context.Params = gin.Params{
			{Key: "resource_type", Value: "Geometry"},
			{Key: "resource_id", Value: "geo-1"},
			{Key: "asset_path", Value: "/" + path},
		}
		app.flow360ResourceVisualizationAsset(context)
		return recorder
	}
	if recorder := call("manifest.json"); recorder.Code != http.StatusOK ||
		!strings.Contains(recorder.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("manifest response %d %#v", recorder.Code, recorder.Header())
	}
	if recorder := call("nested/body.bin"); recorder.Code != http.StatusOK ||
		!bytes.Equal(recorder.Body.Bytes(), []byte{1, 2, 3}) {
		t.Fatalf("bin response %d %v", recorder.Code, recorder.Body.Bytes())
	}
	rangeRecorder := httptest.NewRecorder()
	rangeContext, _ := gin.CreateTestContext(rangeRecorder)
	rangeContext.Request = httptest.NewRequest(http.MethodGet, "/asset", nil)
	rangeContext.Request.Header.Set("Range", "bytes=1-2")
	rangeContext.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "geo-1"},
		{Key: "asset_path", Value: "/nested/body.bin"},
	}
	app.flow360ResourceVisualizationAsset(rangeContext)
	if rangeRecorder.Code != http.StatusPartialContent || !bytes.Equal(rangeRecorder.Body.Bytes(), []byte{2, 3}) {
		t.Fatalf("range response %d %v", rangeRecorder.Code, rangeRecorder.Body.Bytes())
	}
	for _, path := range []string{"../manifest.json", "detail.json", "/tmp/body.bin"} {
		if recorder := call(path); recorder.Code == http.StatusOK {
			t.Fatalf("unsafe path %q was served", path)
		}
	}
}

func TestCaseConvergenceRejectsNonCase(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Geometry/id/convergence", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Geometry"},
		{Key: "resource_id", Value: "id"},
	}

	app.flow360CaseConvergence(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestCaseConvergenceRejectsPathTraversal(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/flow360/resources/Case/../../etc/passwd/convergence", nil)
	context.Params = gin.Params{
		{Key: "resource_type", Value: "Case"},
		{Key: "resource_id", Value: "../../etc/passwd"},
	}

	app.flow360CaseConvergence(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestCompareCasesRequiresAtLeastTwoCases(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	body := `{"case_ids": ["case-1"]}`
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/compare", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.compareCases(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestCompareCasesRejectsInvalidJSON(t *testing.T) {
	app := &Server{
		flow360: &flow360.Client{Binary: "false", Timeout: 100 * time.Millisecond},
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/compare", strings.NewReader("not json"))
	context.Request.Header.Set("Content-Type", "application/json")

	app.compareCases(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestGenerateSweepValidatesBaselineCaseID(t *testing.T) {
	app := &Server{}

	body := `{"parameters": []}`
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/sweep", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.generateSweepPlan(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", recorder.Code)
	}
}

func TestGenerateSweepPreviewReturnsArrayContracts(t *testing.T) {
	app := &Server{}

	body := `{"baseline_case_id":"case-1","parameters":[{"name":"alpha","values":[0,5,10]}]}`
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flow360/sweep", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	app.generateSweepPlan(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Warnings []string `json:"warnings"`
		Plans    []any    `json:"plans"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Warnings == nil || response.Plans == nil {
		t.Fatalf("expected empty JSON arrays, got %s", recorder.Body.String())
	}
}

func TestKPIsFromConvergenceUsesForceHistory(t *testing.T) {
	assessments := map[string]convergence.Assessment{
		"forces": {
			Status: convergence.StatusConverged,
			Metrics: map[string]convergence.Metric{
				"CL": {Name: "CL", Final: 0.42},
				"CD": {Name: "CD", Final: 0.018},
			},
		},
	}

	kpis := kpisFromConvergence(assessments, []string{"Cl", "Cd", "Cm"}, true)
	if len(kpis) != 2 {
		t.Fatalf("expected 2 KPIs, got %#v", kpis)
	}
	if kpis[0].Name != "Cl" || kpis[0].Value != 0.42 || kpis[0].Source != "Flow360 total forces history" {
		t.Fatalf("unexpected lift KPI: %#v", kpis[0])
	}
	if !kpis[1].Converged {
		t.Fatalf("expected converged KPI: %#v", kpis[1])
	}
}

func TestFindDraftInPayloadSupportsProjectDraftEnvelopes(t *testing.T) {
	payload := json.RawMessage(`{"records":[{"id":"dft-1","source_item_id":"geo-1"},{"id":"dft-2","source_id":"sm-1"}]}`)

	record, ok := findDraftInPayload(payload, "dft-2")
	if !ok {
		t.Fatal("expected Draft to be found")
	}
	if got := firstStringField(record, "source_id", "source_item_id"); got != "sm-1" {
		t.Fatalf("got source %q, want sm-1", got)
	}
	if _, ok := findDraftInPayload(payload, "dft-missing"); ok {
		t.Fatal("did not expect an unknown Draft to be found")
	}
}
