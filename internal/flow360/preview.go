package flow360

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
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
	Edges       []MeshEdge  `json:"edges,omitempty"`
	Vertices    int         `json:"vertices"`
	Elements    int         `json:"elements"`
	DownloadURL string      `json:"download_url,omitempty"`
	Warnings    []string    `json:"warnings,omitempty"`
}

type MeshEdge struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Segments int    `json:"segments,omitempty"`
}

type BoundingBox struct {
	Min [3]float64 `json:"min"`
	Max [3]float64 `json:"max"`
}

type MeshGroup struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Color      string   `json:"color"`
	Visible    bool     `json:"visible"`
	Triangles  int      `json:"triangles,omitempty"`
	Vertices   int      `json:"vertices,omitempty"`
	EntityType string   `json:"entity_type,omitempty"`
	Path       []string `json:"path,omitempty"`
}

type uvfEntry struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Type         string `json:"type"`
	Properties   uvfProperties
	Resources    uvfResources
	Attributions uvfAttributions `json:"attributions"`
}

type uvfAttributions struct {
	Faces          []string `json:"faces"`
	Members        []string `json:"members"`
	PackedParentID string   `json:"packedParentId"`
}

type uvfProperties struct {
	Color           int        `json:"color"`
	BoundsMin       [3]float64 `json:"boundsMin"`
	BoundsMax       [3]float64 `json:"boundsMax"`
	BufferLocations struct {
		Indices []struct {
			StartIndex int `json:"startIndex"`
			EndIndex   int `json:"endIndex"`
		} `json:"indices"`
	} `json:"bufferLocations"`
}

type uvfResources struct {
	Buffers struct {
		Type     string `json:"type"`
		Default  int    `json:"default"`
		Sections []struct {
			Name   string `json:"name"`
			Length int    `json:"length"`
		} `json:"sections"`
		Levels []struct {
			Sections []struct {
				Name   string `json:"name"`
				Length int    `json:"length"`
			} `json:"sections"`
		} `json:"levels"`
	} `json:"buffers"`
}

func GeometryUVFPreview(resourceID string, manifest json.RawMessage, assetURL string) (MeshPreview, error) {
	if err := ValidateResourcePath("Geometry", resourceID); err != nil {
		return MeshPreview{}, err
	}
	var entries []uvfEntry
	if err := json.Unmarshal(manifest, &entries); err != nil {
		return MeshPreview{}, errors.New("invalid Geometry UVF manifest")
	}
	preview := MeshPreview{
		AssetURL: assetURL,
		Format:   "flow360-uvf",
		Groups:   []MeshGroup{},
	}
	entryByID := make(map[string]uvfEntry, len(entries))
	parentByID := make(map[string]string, len(entries))
	for _, entry := range entries {
		entryByID[entry.ID] = entry
		for _, memberID := range entry.Attributions.Members {
			parentByID[memberID] = entry.ID
		}
		for _, faceID := range entry.Attributions.Faces {
			parentByID[faceID] = entry.ID
		}
		if entry.Attributions.PackedParentID != "" {
			parentByID[entry.ID] = entry.Attributions.PackedParentID
		}
	}
	boundsSet := false
	for _, entry := range entries {
		switch entry.Type {
		case "SolidGeometry":
			if entry.Properties.BoundsMin != entry.Properties.BoundsMax {
				if !boundsSet {
					preview.BoundingBox.Min = entry.Properties.BoundsMin
					preview.BoundingBox.Max = entry.Properties.BoundsMax
					boundsSet = true
				} else {
					for index := 0; index < 3; index++ {
						preview.BoundingBox.Min[index] = minFloat(preview.BoundingBox.Min[index], entry.Properties.BoundsMin[index])
						preview.BoundingBox.Max[index] = maxFloat(preview.BoundingBox.Max[index], entry.Properties.BoundsMax[index])
					}
				}
			}
			sections := entry.Resources.Buffers.Sections
			if entry.Resources.Buffers.Type == "lod" &&
				entry.Resources.Buffers.Default >= 0 &&
				entry.Resources.Buffers.Default < len(entry.Resources.Buffers.Levels) {
				sections = entry.Resources.Buffers.Levels[entry.Resources.Buffers.Default].Sections
			}
			for _, section := range sections {
				if section.Name == "position" {
					preview.Vertices += section.Length / (4 * 3)
				}
			}
			if len(entry.Attributions.Faces) == 0 && parentByID[entry.ID] != "" {
				vertices, triangles := uvfSolidCounts(sections)
				name := entry.Name
				if strings.TrimSpace(name) == "" {
					name = entry.ID
				}
				preview.Elements += triangles
				preview.Groups = append(preview.Groups, MeshGroup{
					ID:         entry.ID,
					Name:       name,
					Color:      uvfColor(entry.Properties.Color, "#6f8790"),
					Visible:    true,
					Triangles:  triangles,
					Vertices:   vertices,
					EntityType: entry.Type,
					Path:       uvfEntityPath(entry.ID, parentByID, entryByID),
				})
			}
		case "Face":
			triangles := 0
			for _, location := range entry.Properties.BufferLocations.Indices {
				if location.EndIndex > location.StartIndex {
					triangles += (location.EndIndex - location.StartIndex) / 3
				}
			}
			preview.Elements += triangles
			name := entry.Name
			if strings.TrimSpace(name) == "" {
				name = entry.ID
			}
			preview.Groups = append(preview.Groups, MeshGroup{
				ID:         entry.ID,
				Name:       name,
				Color:      uvfColor(entry.Properties.Color, "#6f8790"),
				Visible:    true,
				Triangles:  triangles,
				EntityType: entry.Type,
				Path:       uvfEntityPath(entry.ID, parentByID, entryByID),
			})
		case "Edge":
			segments := 0
			for _, location := range entry.Properties.BufferLocations.Indices {
				points := (location.EndIndex - location.StartIndex) / 3
				if points > 1 {
					segments += points - 1
				}
			}
			name := entry.Name
			if strings.TrimSpace(name) == "" {
				name = entry.ID
			}
			preview.Edges = append(preview.Edges, MeshEdge{ID: entry.ID, Name: name, Segments: segments})
		}
	}
	if preview.AssetURL == "" || len(preview.Groups) == 0 || preview.Vertices == 0 {
		return MeshPreview{}, errors.New("Geometry UVF manifest has no renderable faces")
	}
	return preview, nil
}

func uvfSolidCounts(sections []struct {
	Name   string `json:"name"`
	Length int    `json:"length"`
}) (vertices, triangles int) {
	for _, section := range sections {
		switch section.Name {
		case "position":
			vertices = section.Length / (4 * 3)
		case "indices":
			triangles = section.Length / (4 * 3)
		}
	}
	if triangles == 0 {
		triangles = vertices / 3
	}
	return vertices, triangles
}

func uvfColor(color int, fallback string) string {
	if color <= 0 || color > 0xffffff {
		return fallback
	}
	return fmt.Sprintf("#%06x", color)
}

func uvfEntityPath(entityID string, parentByID map[string]string, entryByID map[string]uvfEntry) []string {
	path := []string{}
	seen := map[string]bool{entityID: true}
	for parentID := parentByID[entityID]; parentID != "" && !seen[parentID]; parentID = parentByID[parentID] {
		seen[parentID] = true
		if parentID != "root_group" {
			path = append(path, parentID)
		}
		if _, exists := entryByID[parentID]; !exists {
			break
		}
	}
	for left, right := 0, len(path)-1; left < right; left, right = left+1, right-1 {
		path[left], path[right] = path[right], path[left]
	}
	return path
}

func minFloat(left, right float64) float64 {
	if left < right {
		return left
	}
	return right
}

func maxFloat(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
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
	preview.AssetURL = extractAssetURL(&detail)
	if preview.AssetURL == "" {
		return MeshPreview{}, fmt.Errorf("Flow360 CLI metadata does not expose a browser-renderable Geometry asset")
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
	preview.AssetURL = extractAssetURL(&detail)
	if preview.AssetURL == "" {
		return MeshPreview{}, fmt.Errorf("Flow360 CLI metadata does not expose a browser-renderable SurfaceMesh asset")
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
	preview.AssetURL = extractAssetURL(&detail)
	if preview.AssetURL == "" {
		return MeshPreview{}, fmt.Errorf("Flow360 CLI metadata does not expose a browser-renderable VolumeMesh asset")
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

func extractAssetURL(detail *ResourceDetail) string {
	if detail == nil {
		return ""
	}
	for _, raw := range []json.RawMessage{detail.Info, detail.Summary, detail.State} {
		if value := findAssetURL(rawToMap(raw)); value != "" {
			return value
		}
	}
	return ""
}

func findAssetURL(data map[string]any) string {
	for key, value := range data {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "preview") || strings.Contains(lower, "asset") || strings.Contains(lower, "gltf") || strings.Contains(lower, "glb") {
			if candidate, ok := value.(string); ok && safePreviewURL(candidate) {
				return candidate
			}
		}
		if nested, ok := value.(map[string]any); ok {
			if candidate := findAssetURL(nested); candidate != "" {
				return candidate
			}
		}
	}
	return ""
}

func safePreviewURL(candidate string) bool {
	parsed, err := url.Parse(strings.TrimSpace(candidate))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return false
	}
	path := strings.ToLower(parsed.Path)
	return strings.HasSuffix(path, ".glb") || strings.HasSuffix(path, ".gltf")
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
				n, err := strconv.Atoi(strings.TrimSpace(v))
				if err == nil {
					return n
				}
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
