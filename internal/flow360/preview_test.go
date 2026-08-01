package flow360

import (
	"encoding/json"
	"strconv"
	"testing"
)

func TestValidateResourcePath(t *testing.T) {
	tests := []struct {
		name    string
		typ     string
		id      string
		wantErr bool
	}{
		{"valid geometry", "Geometry", "geo-123", false},
		{"valid surface mesh", "SurfaceMesh", "sm-abc", false},
		{"valid volume mesh", "VolumeMesh", "vm-1", false},
		{"valid case", "Case", "case-5", false},
		{"empty type", "", "geo-1", true},
		{"empty id", "Geometry", "", true},
		{"path traversal in type", "Geometry/../../etc", "geo-1", true},
		{"path traversal in id", "Geometry", "../etc/passwd", true},
		{"unsupported type", "Unknown", "id-1", true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateResourcePath(test.typ, test.id)
			if test.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !test.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestExtractBoundingBox(t *testing.T) {
	detail := &ResourceDetail{
		Summary: json.RawMessage(`{
			"bounding_box": {
				"min": [0, 0, 0],
				"max": [10, 5, 8]
			}
		}`),
	}
	bbox := extractBoundingBox(detail)
	if bbox == nil {
		t.Fatal("expected bounding box, got nil")
	}
	if bbox.Min[0] != 0 || bbox.Min[1] != 0 || bbox.Min[2] != 0 {
		t.Fatalf("unexpected min: %v", bbox.Min)
	}
	if bbox.Max[0] != 10 || bbox.Max[1] != 5 || bbox.Max[2] != 8 {
		t.Fatalf("unexpected max: %v", bbox.Max)
	}
}

func TestExtractBoundingBoxNested(t *testing.T) {
	detail := &ResourceDetail{
		Info: json.RawMessage(`{
			"mesh_info": {
				"bbox": {
					"min": [-1, -2, -3],
					"max": [4, 5, 6]
				}
			}
		}`),
	}
	bbox := extractBoundingBox(detail)
	if bbox == nil {
		t.Fatal("expected bounding box from nested info")
	}
	if bbox.Min[0] != -1 || bbox.Max[2] != 6 {
		t.Fatalf("unexpected bbox: %v", bbox)
	}
}

func TestExtractBoundingBoxSameMinMaxReturnsNil(t *testing.T) {
	detail := &ResourceDetail{
		Summary: json.RawMessage(`{
			"bounding_box": {
				"min": [5, 5, 5],
				"max": [5, 5, 5]
			}
		}`),
	}
	bbox := extractBoundingBox(detail)
	if bbox != nil {
		t.Fatal("expected nil for equal min/max")
	}
}

func TestExtractInt(t *testing.T) {
	m := map[string]any{
		"cell_count":    float64(10000),
		"num_cells":     float64(20000),
		"element_count": "30000",
	}

	if v := extractInt(m, "cell_count"); v != 10000 {
		t.Fatalf("expected 10000, got %d", v)
	}
	if v := extractInt(m, "missing", "num_cells"); v != 20000 {
		t.Fatalf("expected 20000 via alias, got %d", v)
	}
	if v := extractInt(m, "element_count"); v != 30000 {
		t.Fatalf("expected 30000 from string, got %d", v)
	}
	if v := extractInt(m, "nonexistent"); v != 0 {
		t.Fatalf("expected 0, got %d", v)
	}
}

func TestMeshPreviewMarshal(t *testing.T) {
	preview := MeshPreview{
		Format: "volume-mesh",
		BoundingBox: BoundingBox{
			Min: [3]float64{0, 0, 0},
			Max: [3]float64{10, 10, 10},
		},
		Groups: []MeshGroup{
			{ID: "region-0", Name: "Inlet", Color: "#789521", Visible: true},
		},
		Vertices: 50000,
		Elements: 100000,
		Warnings: []string{"Some data may be incomplete"},
	}
	data, err := json.Marshal(preview)
	if err != nil {
		t.Fatal(err)
	}
	var decoded MeshPreview
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Format != "volume-mesh" {
		t.Fatalf("expected volume-mesh, got %s", decoded.Format)
	}
	if decoded.Vertices != 50000 {
		t.Fatalf("expected 50000 vertices, got %d", decoded.Vertices)
	}
	if len(decoded.Groups) != 1 || decoded.Groups[0].ID != "region-0" {
		t.Fatalf("unexpected groups: %v", decoded.Groups)
	}
}

func TestExtractAssetURLAcceptsOnlyHTTPSGLTF(t *testing.T) {
	detail := &ResourceDetail{
		Info: json.RawMessage(`{"asset":{"preview_url":"https://assets.example.test/wing.glb?signature=abc"}}`),
	}
	if got := extractAssetURL(detail); got != "https://assets.example.test/wing.glb?signature=abc" {
		t.Fatalf("unexpected asset URL %q", got)
	}
	for _, candidate := range []string{
		"http://assets.example.test/wing.glb",
		"file:///tmp/wing.glb",
		"https://assets.example.test/wing.zip",
	} {
		detail.Info = json.RawMessage(`{"preview_url":` + strconv.Quote(candidate) + `}`)
		if got := extractAssetURL(detail); got != "" {
			t.Fatalf("unsafe asset URL was accepted: %q", got)
		}
	}
}

func TestGeometryUVFPreviewBuildsFaceGroupsAndBounds(t *testing.T) {
	manifest := json.RawMessage(`[
		{
			"id":"body-1",
			"type":"SolidGeometry",
			"properties":{"boundsMin":[-2,-1,0],"boundsMax":[2,1,3]},
			"resources":{"buffers":{"type":"buffers","sections":[
				{"name":"position","length":144}
			]}}
		},
		{
			"id":"face-1",
			"name":"Wing",
			"type":"Face",
			"properties":{"bufferLocations":{"indices":[
				{"startIndex":0,"endIndex":6}
			]}}
		},
		{
			"id":"edge-1",
			"name":"Leading edge",
			"type":"Edge",
			"properties":{"bufferLocations":{"indices":[
				{"startIndex":0,"endIndex":9}
			]}}
		}
	]`)
	preview, err := GeometryUVFPreview(
		"geo-1",
		manifest,
		"/api/flow360/resources/Geometry/geo-1/visualization/manifest.json",
	)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Format != "flow360-uvf" || preview.Vertices != 12 || preview.Elements != 2 {
		t.Fatalf("unexpected preview %#v", preview)
	}
	if preview.BoundingBox.Min != [3]float64{-2, -1, 0} ||
		preview.BoundingBox.Max != [3]float64{2, 1, 3} {
		t.Fatalf("unexpected bounds %#v", preview.BoundingBox)
	}
	if len(preview.Groups) != 1 || preview.Groups[0].ID != "face-1" || preview.Groups[0].Triangles != 2 {
		t.Fatalf("unexpected groups %#v", preview.Groups)
	}
	if preview.Groups[0].Color != "#6f8790" {
		t.Fatalf("Geometry faces should share one default color: %#v", preview.Groups)
	}
	if len(preview.Edges) != 1 || preview.Edges[0].ID != "edge-1" || preview.Edges[0].Segments != 2 {
		t.Fatalf("unexpected edges %#v", preview.Edges)
	}
}
