package flow360

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	MaxPreviewSize    = 25 * 1024 * 1024
	MaxPreviewFiles   = 10
	PreviewTimeoutSec = 60
)

type MeshPreview struct {
	AssetURL    string      `json:"asset_url"`
	Format      string      `json:"format"`
	BoundingBox BoundingBox `json:"bounding_box"`
	Groups      []MeshGroup `json:"groups"`
	Vertices    int         `json:"vertices"`
	Elements    int         `json:"elements"`
	DownloadURL string      `json:"download_url,omitempty"`
	Warnings    []string    `json:"warnings,omitempty"`
}

type BoundingBox struct {
	Min [3]float64 `json:"min"`
	Max [3]float64 `json:"max"`
}

type MeshGroup struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Visible   bool   `json:"visible"`
	Triangles int    `json:"triangles,omitempty"`
	Vertices  int    `json:"vertices,omitempty"`
}

func (c *Client) ResourcePreviewManifest(ctx context.Context, resourceType, resourceID string) (MeshPreview, error) {
	preview := MeshPreview{
		Groups: []MeshGroup{},
	}

	switch resourceType {
	case "Geometry":
		return c.geometryPreview(ctx, resourceID)
	case "SurfaceMesh":
		return c.surfaceMeshPreview(ctx, resourceID)
	case "VolumeMesh":
		return c.volumeMeshPreview(ctx, resourceID)
	default:
		return preview, fmt.Errorf("3D preview is not available for resource type %s", resourceType)
	}
}

func (c *Client) geometryPreview(ctx context.Context, resourceID string) (MeshPreview, error) {
	detail, err := c.ResourceDetail(ctx, "Geometry", resourceID)
	if err != nil {
		return MeshPreview{}, fmt.Errorf("geometry detail unavailable: %w", err)
	}

	preview := MeshPreview{
		Format: "geometry",
		Groups: []MeshGroup{
			{ID: "body", Name: "Body", Color: "#789521", Visible: true},
		},
	}

	if bbox := extractBoundingBox(&detail); bbox != nil {
		preview.BoundingBox = *bbox
	} else {
		preview.Warnings = append(preview.Warnings, "Bounding box unavailable; using unit cube display")
	}

	if m := rawToMap(detail.Summary); m != nil {
		if v := extractInt(m, "vertex_count", "num_vertices", "vertices"); v > 0 {
			preview.Vertices = v
		}
		if v := extractInt(m, "triangle_count", "num_triangles", "faces"); v > 0 {
			preview.Elements = v
		}
	}

	if preview.Vertices == 0 {
		preview.Warnings = append(preview.Warnings, "Geometry vertex count unavailable")
	}

	return preview, nil
}

func (c *Client) surfaceMeshPreview(ctx context.Context, resourceID string) (MeshPreview, error) {
	detail, err := c.ResourceDetail(ctx, "SurfaceMesh", resourceID)
	if err != nil {
		return MeshPreview{}, fmt.Errorf("surface mesh detail unavailable: %w", err)
	}

	preview := MeshPreview{
		Format: "surface-mesh",
		Groups: []MeshGroup{
			{ID: "surface", Name: "Surface", Color: "#2b7de9", Visible: true},
		},
	}

	if bbox := extractBoundingBox(&detail); bbox != nil {
		preview.BoundingBox = *bbox
	}

	if m := rawToMap(detail.Summary); m != nil {
		if v := extractInt(m, "node_count", "num_nodes", "vertices"); v > 0 {
			preview.Vertices = v
		}
		if v := extractInt(m, "triangle_count", "num_triangles", "faces"); v > 0 {
			preview.Elements = v
		}
	}

	if m := rawToMap(detail.Info); m != nil {
		if zones, ok := m["boundary_zones"].([]any); ok {
			for i, z := range zones {
				if zm, ok := z.(map[string]any); ok {
					name := fmt.Sprintf("Zone %d", i+1)
					if n, ok := zm["name"].(string); ok {
						name = n
					}
					preview.Groups = append(preview.Groups, MeshGroup{
						ID:      fmt.Sprintf("zone-%d", i),
						Name:    name,
						Color:   colorPalette[i%len(colorPalette)],
						Visible: true,
					})
				}
			}
		}
	}

	return preview, nil
}

func (c *Client) volumeMeshPreview(ctx context.Context, resourceID string) (MeshPreview, error) {
	detail, err := c.ResourceDetail(ctx, "VolumeMesh", resourceID)
	if err != nil {
		return MeshPreview{}, fmt.Errorf("volume mesh detail unavailable: %w", err)
	}

	preview := MeshPreview{
		Format: "volume-mesh",
		Groups: []MeshGroup{
			{ID: "volume", Name: "Volume", Color: "#f97316", Visible: true},
		},
	}

	if bbox := extractBoundingBox(&detail); bbox != nil {
		preview.BoundingBox = *bbox
	}

	if m := rawToMap(detail.Summary); m != nil {
		if v := extractInt(m, "cell_count", "num_cells", "cells", "element_count"); v > 0 {
			preview.Elements = v
		}
		if v := extractInt(m, "node_count", "num_nodes", "vertices"); v > 0 {
			preview.Vertices = v
		}
	}

	if m := rawToMap(detail.Info); m != nil {
		if regions, ok := m["regions"].([]any); ok {
			for i, r := range regions {
				if rm, ok := r.(map[string]any); ok {
					name := fmt.Sprintf("Region %d", i+1)
					if n, ok := rm["name"].(string); ok {
						name = n
					}
					preview.Groups = append(preview.Groups, MeshGroup{
						ID:      fmt.Sprintf("region-%d", i),
						Name:    name,
						Color:   colorPalette[(i+3)%len(colorPalette)],
						Visible: true,
					})
				}
			}
		}
	}

	return preview, nil
}

var colorPalette = []string{
	"#789521", "#2b7de9", "#f97316", "#ec4899", "#8b5cf6",
	"#06b6d4", "#eab308", "#ef4444", "#10b981", "#f59e0b",
}

func rawToMap(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return m
}

func extractBoundingBox(detail *ResourceDetail) *BoundingBox {
	if detail == nil {
		return nil
	}
	for _, raw := range []json.RawMessage{detail.Summary, detail.Info, detail.State} {
		m := rawToMap(raw)
		if m == nil {
			continue
		}
		if bbox := findBBoxInMap(m); bbox != nil {
			return bbox
		}
	}
	return nil
}

func findBBoxInMap(data map[string]any) *BoundingBox {
	for _, key := range []string{"bounding_box", "bbox", "bounding_box_info", "bbox_info"} {
		if val, ok := data[key]; ok {
			return parseBBox(val)
		}
	}
	for _, val := range data {
		if m, ok := val.(map[string]any); ok {
			if bbox := findBBoxInMap(m); bbox != nil {
				return bbox
			}
		}
	}
	return nil
}

func parseBBox(val any) *BoundingBox {
	m, ok := val.(map[string]any)
	if !ok {
		return nil
	}
	var bbox BoundingBox
	if minArr, ok := m["min"].([]any); ok {
		for i := 0; i < 3 && i < len(minArr); i++ {
			if f, ok := minArr[i].(float64); ok {
				bbox.Min[i] = f
			}
		}
	}
	if maxArr, ok := m["max"].([]any); ok {
		for i := 0; i < 3 && i < len(maxArr); i++ {
			if f, ok := maxArr[i].(float64); ok {
				bbox.Max[i] = f
			}
		}
	}
	if bbox.Min == bbox.Max {
		return nil
	}
	return &bbox
}

func extractInt(m map[string]any, keys ...string) int {
	for _, key := range keys {
		if val, ok := m[key]; ok {
			switch v := val.(type) {
			case float64:
				return int(v)
			case int:
				return v
			case json.Number:
				n, _ := v.Int64()
				return int(n)
			case string:
				var n int
				fmt.Sscanf(v, "%d", &n)
				return n
			}
		}
	}
	return 0
}

func ValidateResourcePath(resourceType, resourceID string) error {
	cleanType := resourceType
	cleanID := resourceID
	if strings.Contains(cleanType, "..") || strings.Contains(cleanID, "..") {
		return fmt.Errorf("path traversal not allowed")
	}
	if resourceType == "" || resourceID == "" {
		return fmt.Errorf("empty resource identifier")
	}
	allowedTypes := map[string]bool{"Geometry": true, "SurfaceMesh": true, "VolumeMesh": true, "Case": true}
	if !allowedTypes[resourceType] {
		return fmt.Errorf("unsupported resource type: %s", resourceType)
	}
	return nil
}
