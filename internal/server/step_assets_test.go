package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/stepassets"
)

type fixedSTEPValidator struct {
	report aicreate.GeometryValidation
	err    error
}

type fixedSTEPPreviewer struct{ calls int }

type fixedSTEPThumbnailer struct{ calls int }

func (thumbnailer *fixedSTEPThumbnailer) ThumbnailSTEP(_ context.Context, _ string, output string) error {
	thumbnailer.calls++
	return os.WriteFile(output, []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0o600)
}

func (previewer *fixedSTEPPreviewer) PreviewSTEP(_ context.Context, _ []string, output string) (aicreate.STEPPreview, error) {
	previewer.calls++
	if err := os.WriteFile(output, []byte("glTF"), 0o600); err != nil {
		return aicreate.STEPPreview{}, err
	}
	return aicreate.STEPPreview{Vertices: 24, Triangles: 12, Bounds: []float64{0, 0, 0, 12, 6, 3}}, nil
}

func (v fixedSTEPValidator) ValidateSTEP(context.Context, string) (aicreate.GeometryValidation, error) {
	return v.report, v.err
}

func stepAssetTestRouter(app *Server) *gin.Engine {
	router := gin.New()
	router.GET("/api/step-assets", app.listSTEPAssets)
	router.POST("/api/step-assets", app.createSTEPAsset)
	router.POST("/api/step-assets/folders", app.createSTEPFolder)
	router.PATCH("/api/step-assets/folders/:folder_id", app.updateSTEPFolder)
	router.DELETE("/api/step-assets/folders/:folder_id", app.deleteSTEPFolder)
	router.PATCH("/api/step-assets/:asset_id/folder", app.moveSTEPAsset)
	router.POST("/api/step-assets/:asset_id/versions/:version_id/create-project", app.createProjectFromSTEPAsset)
	router.GET("/api/step-assets/:asset_id/versions/:version_id/preview", app.previewSTEPAssetVersion)
	router.GET("/api/step-assets/:asset_id/versions/:version_id/thumbnail.svg", app.thumbnailSTEPAssetVersion)
	return router
}

func TestSTEPLibraryFolderAPIsAndFolderUpload(t *testing.T) {
	store, err := stepassets.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{stepAssets: store, stepValidator: fixedSTEPValidator{report: aicreate.GeometryValidation{SolidCount: 1, FaceCount: 1, Volume: 1, Kernel: "test"}}}
	router := stepAssetTestRouter(app)

	create := httptest.NewRequest(http.MethodPost, "/api/step-assets/folders", strings.NewReader(`{"name":"Designs","parent_id":"step-root"}`))
	create.Header.Set("Content-Type", "application/json")
	created := httptest.NewRecorder()
	router.ServeHTTP(created, create)
	if created.Code != http.StatusCreated {
		t.Fatalf("create folder status=%d body=%s", created.Code, created.Body.String())
	}
	var folder stepassets.Folder
	if err := json.Unmarshal(created.Body.Bytes(), &folder); err != nil {
		t.Fatal(err)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("name", "Bracket")
	_ = writer.WriteField("folder_id", folder.ID)
	part, _ := writer.CreateFormFile("file", "bracket.step")
	_, _ = part.Write([]byte("ISO-10303-21; bracket"))
	_ = writer.Close()
	upload := httptest.NewRequest(http.MethodPost, "/api/step-assets", &body)
	upload.Header.Set("Content-Type", writer.FormDataContentType())
	uploaded := httptest.NewRecorder()
	router.ServeHTTP(uploaded, upload)
	if uploaded.Code != http.StatusCreated {
		t.Fatalf("upload status=%d body=%s", uploaded.Code, uploaded.Body.String())
	}
	if assets := store.List(); len(assets) != 1 || assets[0].FolderID != folder.ID {
		t.Fatalf("unexpected folder assignment: %#v", assets)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if store.List()[0].Versions[0].Validation.Status == stepassets.StatusReady {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	listed := httptest.NewRecorder()
	router.ServeHTTP(listed, httptest.NewRequest(http.MethodGet, "/api/step-assets", nil))
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), `"folder_root"`) || !strings.Contains(listed.Body.String(), "Designs") {
		t.Fatalf("list status=%d body=%s", listed.Code, listed.Body.String())
	}
}

func TestHumanizeSTEPPreviewErrorDoesNotExposeRuntimeDetails(t *testing.T) {
	raw := errors.New(`STEP preview generation failed: Traceback /Users/person/.cache/uv preview_step.py`)
	message := humanizeSTEPPreviewError(raw)
	if strings.Contains(message, "Traceback") || strings.Contains(message, "/Users/") || !strings.Contains(message, "Retry") {
		t.Fatalf("unsafe preview error: %q", message)
	}
}

func TestSTEPLibraryUploadPersistsAndValidatesVersion(t *testing.T) {
	store, err := stepassets.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{stepAssets: store, stepValidator: fixedSTEPValidator{report: aicreate.GeometryValidation{SolidCount: 1, FaceCount: 6, Volume: 1, Kernel: "test"}}}
	router := stepAssetTestRouter(app)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("name", "Library wing")
	_ = writer.WriteField("unit", "mm")
	part, err := writer.CreateFormFile("file", "wing.step")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("ISO-10303-21;\nDATA;\n#1=MANIFOLD_SOLID_BREP('wing',#2);\n#2=ADVANCED_FACE('',(),#3,.T.);\nENDSEC;\nEND-ISO-10303-21;"))
	_ = writer.Close()
	request := httptest.NewRequest(http.MethodPost, "/api/step-assets", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("upload status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		assets := store.List()
		if len(assets) == 1 && assets[0].Versions[0].Validation.Status == stepassets.StatusReady {
			if assets[0].Versions[0].Unit != "mm" || assets[0].Versions[0].Validation.Report.FaceCount != 6 {
				t.Fatalf("validated version mismatch: %#v", assets[0].Versions[0])
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("uploaded STEP did not finish asynchronous validation")
}

func TestSTEPLibraryCreatesFlow360ProjectFromReadyVersion(t *testing.T) {
	root := t.TempDir()
	store, err := stepassets.NewStore(filepath.Join(root, "library"))
	if err != nil {
		t.Fatal(err)
	}
	asset, version, err := store.Create("Ready wing", "", "wing.step", "m", "upload", "", "", strings.NewReader("ISO-10303-21; MANIFOLD_SOLID_BREP ADVANCED_FACE"))
	if err != nil {
		t.Fatal(err)
	}
	report := aicreate.GeometryValidation{SolidCount: 1, FaceCount: 6, Volume: 1, Kernel: "test"}
	if _, err := store.SetValidation(asset.ID, version.ID, stepassets.Validation{Status: stepassets.StatusReady, Report: &report}); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(root, "flow360")
	script := `#!/bin/sh
case " $* " in
  *" project create "*) printf '%s' '{"project_id":"project-step-1","root_resource_id":"geometry-step-1","root_resource_type":"geometry"}' ;;
  *) exit 9 ;;
esac
`
	if err := os.WriteFile(binary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	app := &Server{stepAssets: store, flow360: &flow360.Client{Binary: binary, Timeout: time.Second}}
	router := stepAssetTestRouter(app)
	payload, _ := json.Marshal(createSTEPProjectRequest{FolderID: "folder-1", Name: "From library"})
	request := httptest.NewRequest(http.MethodPost, "/api/step-assets/"+asset.ID+"/versions/"+version.ID+"/create-project", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated || !strings.Contains(recorder.Body.String(), asset.ID) || !strings.Contains(recorder.Body.String(), "project-step-1") {
		t.Fatalf("create status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestPrepareAICreateCADUsesValidatedLibraryVersion(t *testing.T) {
	root := t.TempDir()
	store, err := stepassets.NewStore(filepath.Join(root, "library"))
	if err != nil {
		t.Fatal(err)
	}
	asset, version, err := store.Create("Library bracket", "", "bracket.step", "mm", "upload", "", "", strings.NewReader("ISO-10303-21; MANIFOLD_SOLID_BREP ADVANCED_FACE"))
	if err != nil {
		t.Fatal(err)
	}
	report := aicreate.GeometryValidation{SolidCount: 1, FaceCount: 6, Volume: 125, Bounds: []float64{0, 0, 0, 10, 5, 2}, Kernel: "OpenCascade"}
	if _, err := store.SetValidation(asset.ID, version.ID, stepassets.Validation{Status: stepassets.StatusReady, Report: &report}); err != nil {
		t.Fatal(err)
	}
	app := &Server{workDir: root, stepAssets: store}
	progressID := "aip-library-source-1234"
	app.startAICreateProgress(progressID)
	blueprint, validation, path, name, err := app.prepareAICreateCAD(context.Background(), aiCreateSession{ID: "aic-library", STEPAssetID: asset.ID, STEPVersionID: version.ID}, progressID)
	if err != nil {
		t.Fatal(err)
	}
	if blueprint.Geometry.Generator != "step-library" || blueprint.Geometry.Unit != "mm" || path == "" || name != "bracket.step" || validation.Volume != 125 {
		t.Fatalf("library source was not reused: blueprint=%#v validation=%#v path=%q name=%q", blueprint, validation, path, name)
	}
}

func TestSTEPPreviewComparesReadyVersionsAndCachesAsset(t *testing.T) {
	root := t.TempDir()
	store, err := stepassets.NewStore(filepath.Join(root, "library"))
	if err != nil {
		t.Fatal(err)
	}
	asset, first, err := store.Create("Bracket", "", "bracket.step", "mm", "upload", "", "", strings.NewReader("ISO-10303-21; first"))
	if err != nil {
		t.Fatal(err)
	}
	_, second, err := store.AddVersion(asset.ID, "bracket-v2.step", "mm", "upload", "", first.ID, strings.NewReader("ISO-10303-21; second"))
	if err != nil {
		t.Fatal(err)
	}
	firstReport := aicreate.GeometryValidation{SolidCount: 1, FaceCount: 6, Volume: 100, Bounds: []float64{0, 0, 0, 10, 5, 2}}
	secondReport := aicreate.GeometryValidation{SolidCount: 2, FaceCount: 9, Volume: 120, Bounds: []float64{-1, 0, 0, 12, 6, 3}}
	if _, err := store.SetValidation(asset.ID, first.ID, stepassets.Validation{Status: stepassets.StatusReady, Report: &firstReport}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetValidation(asset.ID, second.ID, stepassets.Validation{Status: stepassets.StatusReady, Report: &secondReport}); err != nil {
		t.Fatal(err)
	}
	previewer := &fixedSTEPPreviewer{}
	app := &Server{workDir: root, stepAssets: store, stepPreviewer: previewer}
	router := stepAssetTestRouter(app)
	path := "/api/step-assets/" + asset.ID + "/versions/" + second.ID + "/preview?compare_version_id=" + first.ID
	for attempt := 0; attempt < 2; attempt++ {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"volume_delta":20`) || !strings.Contains(recorder.Body.String(), `"bounds_delta"`) || !strings.Contains(recorder.Body.String(), `"vertices":24`) {
			t.Fatalf("preview status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	}
	if previewer.calls != 1 {
		t.Fatalf("preview cache missed: calls=%d", previewer.calls)
	}
}

func TestSTEPThumbnailRendersAndCachesReadyVersion(t *testing.T) {
	root := t.TempDir()
	store, err := stepassets.NewStore(filepath.Join(root, "library"))
	if err != nil {
		t.Fatal(err)
	}
	asset, version, err := store.Create("Wheel", "", "wheel.step", "mm", "upload", "", "", strings.NewReader("ISO-10303-21;"))
	if err != nil {
		t.Fatal(err)
	}
	report := aicreate.GeometryValidation{SolidCount: 1, FaceCount: 4, Volume: 10, Bounds: []float64{-1, -1, -1, 1, 1, 1}}
	if _, err := store.SetValidation(asset.ID, version.ID, stepassets.Validation{Status: stepassets.StatusReady, Report: &report}); err != nil {
		t.Fatal(err)
	}
	thumbnailer := &fixedSTEPThumbnailer{}
	router := stepAssetTestRouter(&Server{workDir: root, stepAssets: store, stepThumbnailer: thumbnailer})
	path := "/api/step-assets/" + asset.ID + "/versions/" + version.ID + "/thumbnail.svg"
	for attempt := 0; attempt < 2; attempt++ {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "<svg") {
			t.Fatalf("thumbnail status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	}
	if thumbnailer.calls != 1 {
		t.Fatalf("thumbnail cache missed: calls=%d", thumbnailer.calls)
	}
}
