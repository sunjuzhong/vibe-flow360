package server

import (
	"bytes"
	"context"
	"encoding/json"
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

func (v fixedSTEPValidator) ValidateSTEP(context.Context, string) (aicreate.GeometryValidation, error) {
	return v.report, v.err
}

func stepAssetTestRouter(app *Server) *gin.Engine {
	router := gin.New()
	router.GET("/api/step-assets", app.listSTEPAssets)
	router.POST("/api/step-assets", app.createSTEPAsset)
	router.POST("/api/step-assets/:asset_id/versions/:version_id/create-project", app.createProjectFromSTEPAsset)
	return router
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
