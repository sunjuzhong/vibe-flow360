package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/annotations"
)

func annotationTestRouter(t *testing.T, root string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	store, err := annotations.NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	NewAnnotationHandlers(store).RegisterRoutes(router.Group("/api"))
	return router
}

func annotationRequestBody(projectID string) []byte {
	return []byte(`{
      "schemaVersion": 1,
      "resourceRef": {"id":"geo-1","type":"Geometry"},
      "coordinateFrame": {"kind":"asset-local","resourceRef":{"id":"geo-1","type":"Geometry"}},
      "toolId": "distance",
      "name": "Clearance",
      "points": [{
        "localPosition":[0,0,0], "worldPosition":[10,0,0],
        "projectId":"` + projectID + `",
        "resourceRef":{"id":"geo-1","type":"Geometry"},
        "coordinateFrame":{"kind":"asset-local","resourceRef":{"id":"geo-1","type":"Geometry"}},
        "snap":{"type":"surface"}
      }],
      "result":{"distance":2}, "style":{"color":"#fff"}, "visible":true
    }`)
}

func performAnnotationRequest(router http.Handler, method, path string, body []byte) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestAnnotationHandlersCRUDAndEmptyList(t *testing.T) {
	router := annotationTestRouter(t, t.TempDir())
	empty := performAnnotationRequest(router, http.MethodGet, "/api/projects/project-a/annotations", nil)
	if empty.Code != http.StatusOK || strings.TrimSpace(empty.Body.String()) != `{"annotations":[]}` {
		t.Fatalf("empty list: %d %s", empty.Code, empty.Body.String())
	}

	createdResponse := performAnnotationRequest(
		router, http.MethodPost, "/api/projects/project-a/annotations", annotationRequestBody("project-a"),
	)
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", createdResponse.Code, createdResponse.Body.String())
	}
	var created annotations.Annotation
	if err := json.Unmarshal(createdResponse.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ProjectID != "project-a" || created.ID == "" {
		t.Fatalf("server identity missing: %#v", created)
	}

	get := performAnnotationRequest(router, http.MethodGet,
		"/api/projects/project-a/annotations/"+created.ID, nil)
	if get.Code != http.StatusOK {
		t.Fatalf("get: %d %s", get.Code, get.Body.String())
	}
	patch := performAnnotationRequest(router, http.MethodPatch,
		"/api/projects/project-a/annotations/"+created.ID,
		[]byte(`{"name":"Renamed","visible":false,"style":{"width":2}}`))
	if patch.Code != http.StatusOK {
		t.Fatalf("patch: %d %s", patch.Code, patch.Body.String())
	}
	var updated annotations.Annotation
	if err := json.Unmarshal(patch.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Renamed" || updated.Visible || updated.ProjectID != created.ProjectID ||
		updated.ID != created.ID || !updated.CreatedAt.Equal(created.CreatedAt) {
		t.Fatalf("patch changed immutable identity: %#v", updated)
	}
	deleted := performAnnotationRequest(router, http.MethodDelete,
		"/api/projects/project-a/annotations/"+created.ID, nil)
	if deleted.Code != http.StatusNoContent || deleted.Body.Len() != 0 {
		t.Fatalf("delete: %d %s", deleted.Code, deleted.Body.String())
	}
}

func TestAnnotationHandlersPreventCrossProjectIDORAndOwnershipOverride(t *testing.T) {
	router := annotationTestRouter(t, t.TempDir())
	createdResponse := performAnnotationRequest(
		router, http.MethodPost, "/api/projects/project-b/annotations", annotationRequestBody("project-b"),
	)
	var created annotations.Annotation
	if err := json.Unmarshal(createdResponse.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete} {
		var body []byte
		if method == http.MethodPatch {
			body = []byte(`{"visible":false}`)
		}
		response := performAnnotationRequest(router, method,
			"/api/projects/project-a/annotations/"+created.ID, body)
		if response.Code != http.StatusNotFound {
			t.Errorf("cross-project %s: %d %s", method, response.Code, response.Body.String())
		}
	}

	overrideCreate := bytes.Replace(annotationRequestBody("project-a"),
		[]byte(`"schemaVersion": 1,`), []byte(`"schemaVersion": 1,"projectId":"project-b",`), 1)
	response := performAnnotationRequest(router, http.MethodPost,
		"/api/projects/project-a/annotations", overrideCreate)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("create ownership override: %d %s", response.Code, response.Body.String())
	}
	response = performAnnotationRequest(router, http.MethodPatch,
		"/api/projects/project-b/annotations/"+created.ID, []byte(`{"projectId":"project-a"}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("patch ownership override: %d %s", response.Code, response.Body.String())
	}
}

func TestAnnotationHandlersRejectBadJSONSchemaAndOversize(t *testing.T) {
	router := annotationTestRouter(t, t.TempDir())
	tests := []struct {
		name string
		body []byte
	}{
		{"bad json", []byte(`{"schemaVersion":`)},
		{"unknown schema", bytes.Replace(annotationRequestBody("project-a"), []byte(`"schemaVersion": 1`), []byte(`"schemaVersion": 99`), 1)},
		{"non finite", bytes.Replace(annotationRequestBody("project-a"), []byte(`[0,0,0]`), []byte(`[NaN,0,0]`), 1)},
		{"multiple values", append(annotationRequestBody("project-a"), []byte(` {}`)...)},
		{"oversize", bytes.Replace(annotationRequestBody("project-a"), []byte(`"Clearance"`),
			[]byte(`"`+strings.Repeat("x", annotations.MaxPayloadSize)+`"`), 1)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := performAnnotationRequest(router, http.MethodPost,
				"/api/projects/project-a/annotations", test.body)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("got %d: %s", response.Code, response.Body.String())
			}
			var payload struct {
				Code string `json:"code"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Code != "validation_error" {
				t.Fatalf("error code = %q", payload.Code)
			}
		})
	}
}

func TestAnnotationHandlersReportCorruptStoredJSON(t *testing.T) {
	root := t.TempDir()
	router := annotationTestRouter(t, root)
	dir := filepath.Join(root, "project-a")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ann-bad.json"), []byte(`{"broken":`), 0o600); err != nil {
		t.Fatal(err)
	}
	response := performAnnotationRequest(router, http.MethodGet,
		"/api/projects/project-a/annotations/ann-bad", nil)
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "corrupt_data") {
		t.Fatalf("corrupt get: %d %s", response.Code, response.Body.String())
	}
}
