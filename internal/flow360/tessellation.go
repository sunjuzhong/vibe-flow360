package flow360

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	maxTessellationManifestSize = 2 * 1024 * 1024
	maxTessellationBinSize      = MaxPreviewSize
	maxTessellationFiles        = 64
	visualizationTimeout        = 180 * time.Second
)

type ResourceVisualization struct {
	Manifest json.RawMessage
	Bins     map[string][]byte
	Catalog  VisualizationCatalog
}

type VisualizationCatalog struct {
	Objects []VisualizationObject `json:"objects"`
	Groups  []VisualizationGroup  `json:"groups"`
	Fields  []string              `json:"fields"`
}

type VisualizationObject struct {
	ID         string          `json:"id"`
	BufferPath string          `json:"buffer_path"`
	Sections   []string        `json:"sections"`
	Bounds     json.RawMessage `json:"bounds,omitempty"`
}

type VisualizationGroup struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
	Type string `json:"type"`
}

// GeometryVisualization remains an alias while the project mirror migrates to
// the resource-type-aware API.
type GeometryVisualization = ResourceVisualization

type VisualizationErrorKind string

const (
	VisualizationInvalid     VisualizationErrorKind = "invalid"
	VisualizationUnavailable VisualizationErrorKind = "unavailable"
	VisualizationTimeout     VisualizationErrorKind = "timeout"
	VisualizationDownload    VisualizationErrorKind = "download"
	VisualizationMalformed   VisualizationErrorKind = "malformed"
)

type VisualizationError struct {
	Kind         VisualizationErrorKind
	ResourceType string
	Err          error
}

func (e *VisualizationError) Error() string {
	return fmt.Sprintf("%s visualization %s: %v", e.ResourceType, e.Kind, e.Err)
}

func (e *VisualizationError) Unwrap() error {
	return e.Err
}

func (c *Client) GeometryVisualization(ctx context.Context, resourceID string) (ResourceVisualization, error) {
	return c.ResourceVisualization(ctx, "Geometry", resourceID)
}

func (c *Client) ResourceVisualization(
	ctx context.Context,
	resourceType string,
	resourceID string,
) (ResourceVisualization, error) {
	if err := ValidateResourcePath(resourceType, resourceID); err != nil {
		return ResourceVisualization{}, visualizationError(VisualizationInvalid, resourceType, err)
	}
	python, err := c.flow360Python()
	if err != nil {
		return ResourceVisualization{}, visualizationError(VisualizationUnavailable, resourceType, err)
	}
	staging, err := os.MkdirTemp("", "vibesim-resource-visualization-*")
	if err != nil {
		return ResourceVisualization{}, visualizationError(
			VisualizationDownload,
			resourceType,
			fmt.Errorf("create visualization staging directory: %w", err),
		)
	}
	defer os.RemoveAll(staging)

	runCtx, cancel := context.WithTimeout(ctx, visualizationTimeout)
	defer cancel()
	command := exec.CommandContext(
		runCtx,
		python,
		"-c",
		resourceVisualizationBridge,
		resourceType,
		resourceID,
		staging,
		strings.TrimSpace(c.Environment),
	)
	command.Env = append(os.Environ(), "SIMCLOUD_PROFILE="+strings.TrimSpace(c.Profile))
	if c.APIKey != "" {
		command.Env = append(command.Env, "FLOW360_APIKEY="+c.APIKey)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if _, err := command.Output(); err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return ResourceVisualization{}, visualizationError(
				VisualizationTimeout,
				resourceType,
				errors.New("download timed out"),
			)
		}
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return ResourceVisualization{}, visualizationError(
			VisualizationDownload,
			resourceType,
			errors.New(compactOutput([]byte(message))),
		)
	}

	manifestPath := filepath.Join(staging, "manifest.json")
	manifest, err := readLimitedRegularFile(manifestPath, maxTessellationManifestSize)
	if err != nil {
		return ResourceVisualization{}, visualizationError(
			VisualizationMalformed,
			resourceType,
			fmt.Errorf("read manifest: %w", err),
		)
	}
	binPaths, err := TessellationDefaultBinPaths(manifest)
	if err != nil {
		return ResourceVisualization{}, visualizationError(VisualizationMalformed, resourceType, err)
	}
	catalog, err := ParseVisualizationCatalog(manifest)
	if err != nil {
		return ResourceVisualization{}, visualizationError(VisualizationMalformed, resourceType, err)
	}
	bins := make(map[string][]byte, len(binPaths))
	var totalSize int
	for _, relative := range binPaths {
		payload, err := readLimitedRegularFile(filepath.Join(staging, filepath.FromSlash(relative)), maxTessellationBinSize)
		if err != nil {
			return ResourceVisualization{}, visualizationError(
				VisualizationMalformed,
				resourceType,
				fmt.Errorf("read buffer %q: %w", relative, err),
			)
		}
		totalSize += len(payload)
		if totalSize > MaxPreviewSize {
			return ResourceVisualization{}, visualizationError(
				VisualizationMalformed,
				resourceType,
				fmt.Errorf("default LOD exceeds %d byte limit", MaxPreviewSize),
			)
		}
		bins[relative] = payload
	}
	return ResourceVisualization{Manifest: manifest, Bins: bins, Catalog: catalog}, nil
}

func visualizationError(
	kind VisualizationErrorKind,
	resourceType string,
	err error,
) *VisualizationError {
	return &VisualizationError{Kind: kind, ResourceType: resourceType, Err: err}
}

func (c *Client) flow360Python() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("VIBESIM_FLOW360_PYTHON")); configured != "" {
		if info, err := os.Stat(configured); err == nil && !info.IsDir() {
			return configured, nil
		}
		return "", errors.New("VIBESIM_FLOW360_PYTHON does not point to an executable file")
	}
	binary, err := exec.LookPath(c.Binary)
	if err != nil {
		return "", fmt.Errorf("find flow360 executable: %w", err)
	}
	for _, name := range []string{"python", "python3"} {
		candidate := filepath.Join(filepath.Dir(binary), name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	executable, err := os.Open(binary)
	if err == nil {
		defer executable.Close()
		head := make([]byte, 4096)
		count, _ := executable.Read(head)
		firstLine, _, _ := bytes.Cut(head[:count], []byte{'\n'})
		shebang := strings.TrimSpace(strings.TrimPrefix(string(firstLine), "#!"))
		if strings.Contains(strings.ToLower(shebang), "python") {
			if info, statErr := os.Stat(shebang); statErr == nil && !info.IsDir() {
				return shebang, nil
			}
		}
	}
	return "", errors.New("could not find the Python interpreter used by the flow360 executable")
}

func TessellationBinPaths(manifest json.RawMessage) ([]string, error) {
	return tessellationBinPaths(manifest, false)
}

func TessellationDefaultBinPaths(manifest json.RawMessage) ([]string, error) {
	return tessellationBinPaths(manifest, true)
}

func tessellationBinPaths(manifest json.RawMessage, defaultLODOnly bool) ([]string, error) {
	if !json.Valid(manifest) {
		return nil, errors.New("visualization manifest is invalid JSON")
	}
	var entries []map[string]any
	if err := json.Unmarshal(manifest, &entries); err != nil {
		return nil, errors.New("visualization manifest must be a JSON array")
	}
	paths := map[string]struct{}{}
	for _, entry := range entries {
		if entry["type"] != "SolidGeometry" {
			continue
		}
		resources, _ := entry["resources"].(map[string]any)
		buffers, _ := resources["buffers"].(map[string]any)
		if buffers == nil {
			continue
		}
		if buffers["type"] == "lod" {
			levels, _ := buffers["levels"].([]any)
			if defaultLODOnly {
				index, err := tessellationDefaultLOD(buffers, len(levels))
				if err != nil {
					return nil, err
				}
				typed, ok := levels[index].(map[string]any)
				if !ok {
					return nil, errors.New("visualization default LOD entry is invalid")
				}
				if err := collectTessellationPath(paths, typed["path"]); err != nil {
					return nil, err
				}
				continue
			}
			for _, level := range levels {
				if typed, ok := level.(map[string]any); ok {
					if err := collectTessellationPath(paths, typed["path"]); err != nil {
						return nil, err
					}
				}
			}
			continue
		}
		if err := collectTessellationPath(paths, buffers["path"]); err != nil {
			return nil, err
		}
	}
	if len(paths) == 0 {
		return nil, errors.New("visualization manifest does not reference a binary buffer")
	}
	if len(paths) > maxTessellationFiles {
		return nil, fmt.Errorf("visualization references more than %d buffers", maxTessellationFiles)
	}
	result := make([]string, 0, len(paths))
	for path := range paths {
		result = append(result, path)
	}
	sortStrings(result)
	return result, nil
}

func tessellationDefaultLOD(buffers map[string]any, levelCount int) (int, error) {
	if levelCount == 0 {
		return 0, errors.New("visualization LOD has no levels")
	}
	index := 0
	if raw, exists := buffers["default"]; exists {
		value, ok := raw.(float64)
		if !ok {
			return 0, errors.New("visualization default LOD must be an integer")
		}
		index = int(value)
		if value != float64(index) {
			return 0, errors.New("visualization default LOD must be an integer")
		}
	}
	if index < 0 || index >= levelCount {
		return 0, errors.New("visualization default LOD is out of range")
	}
	return index, nil
}

func ParseVisualizationCatalog(manifest json.RawMessage) (VisualizationCatalog, error) {
	var entries []map[string]any
	if !json.Valid(manifest) || json.Unmarshal(manifest, &entries) != nil {
		return VisualizationCatalog{}, errors.New("visualization manifest must be a JSON array")
	}
	catalog := VisualizationCatalog{
		Objects: []VisualizationObject{},
		Groups:  []VisualizationGroup{},
		Fields:  []string{},
	}
	fieldSet := map[string]struct{}{}
	for _, entry := range entries {
		entryType, _ := entry["type"].(string)
		id, _ := entry["id"].(string)
		name, _ := entry["name"].(string)
		if entryType != "SolidGeometry" {
			if entryType == "Face" || entryType == "GeometryGroup" {
				catalog.Groups = append(catalog.Groups, VisualizationGroup{
					ID: id, Name: name, Type: entryType,
				})
			}
			continue
		}
		resources, _ := entry["resources"].(map[string]any)
		buffers, _ := resources["buffers"].(map[string]any)
		selected, err := defaultTessellationBuffer(buffers)
		if err != nil {
			return VisualizationCatalog{}, fmt.Errorf("object %q: %w", id, err)
		}
		path, ok := selected["path"].(string)
		if !ok {
			return VisualizationCatalog{}, fmt.Errorf("object %q: visualization buffer path is missing", id)
		}
		if err := collectTessellationPath(map[string]struct{}{}, path); err != nil {
			return VisualizationCatalog{}, fmt.Errorf("object %q: %w", id, err)
		}
		object := VisualizationObject{ID: id, BufferPath: path, Sections: []string{}}
		if sections, ok := selected["sections"].([]any); ok {
			for _, rawSection := range sections {
				section, _ := rawSection.(map[string]any)
				sectionName, _ := section["name"].(string)
				if sectionName == "" {
					continue
				}
				object.Sections = append(object.Sections, sectionName)
				if !visualizationStructuralSection(sectionName) {
					fieldSet[sectionName] = struct{}{}
				}
			}
		}
		bounds, hasBounds := selected["bounds"]
		if !hasBounds {
			bounds, hasBounds = buffers["bounds"]
		}
		if hasBounds {
			rawBounds, err := json.Marshal(bounds)
			if err != nil {
				return VisualizationCatalog{}, fmt.Errorf("object %q: invalid field bounds", id)
			}
			object.Bounds = rawBounds
		}
		catalog.Objects = append(catalog.Objects, object)
	}
	for field := range fieldSet {
		catalog.Fields = append(catalog.Fields, field)
	}
	sortStrings(catalog.Fields)
	if len(catalog.Objects) == 0 {
		return VisualizationCatalog{}, errors.New("visualization manifest has no renderable objects")
	}
	return catalog, nil
}

func defaultTessellationBuffer(buffers map[string]any) (map[string]any, error) {
	if buffers == nil {
		return nil, errors.New("visualization buffers are missing")
	}
	if buffers["type"] != "lod" {
		return buffers, nil
	}
	levels, _ := buffers["levels"].([]any)
	index, err := tessellationDefaultLOD(buffers, len(levels))
	if err != nil {
		return nil, err
	}
	selected, ok := levels[index].(map[string]any)
	if !ok {
		return nil, errors.New("visualization default LOD entry is invalid")
	}
	return selected, nil
}

func visualizationStructuralSection(name string) bool {
	switch name {
	case "indices", "position", "elementGroupId", "nodeNormals":
		return true
	default:
		return false
	}
}

func collectTessellationPath(paths map[string]struct{}, value any) error {
	path, ok := value.(string)
	if !ok {
		return errors.New("Geometry visualization buffer path is missing")
	}
	if strings.Contains(path, "\\") {
		return errors.New("Geometry visualization buffer path must use forward slashes")
	}
	path = strings.TrimSpace(path)
	clean := filepath.ToSlash(filepath.Clean(path))
	if path == "" || clean != path || strings.HasPrefix(clean, "/") || strings.Contains(clean, "..") {
		return errors.New("Geometry visualization buffer path is unsafe")
	}
	if !strings.HasSuffix(strings.ToLower(clean), ".bin") {
		return errors.New("Geometry visualization buffer must use the .bin extension")
	}
	paths[clean] = struct{}{}
	return nil
}

func readLimitedRegularFile(path string, limit int) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("visualization asset must be a regular file")
	}
	if info.Size() > int64(limit) {
		return nil, fmt.Errorf("visualization asset exceeds %d byte limit", limit)
	}
	return os.ReadFile(path)
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

const resourceVisualizationBridge = `
import json
import os
from pathlib import Path, PurePosixPath
import sys

from flow360.component.simulation.web.asset_webapi import (
    CaseWebApi,
    GeometryWebApi,
    SurfaceMeshWebApi,
    VolumeMeshWebApi,
)
from flow360.environment import Env, EnvironmentConfig

resource_type, resource_id, output_dir, environment = sys.argv[1:5]
normalized = environment.strip().lower()
if normalized in ("", "default", "prod", "production"):
    Env.prod.active()
elif normalized == "dev":
    Env.dev.active()
elif normalized == "uat":
    Env.uat.active()
elif normalized == "preprod":
    Env.preprod.active()
else:
    EnvironmentConfig.from_config(environment).active()

root = Path(output_dir)
root.mkdir(parents=True, exist_ok=True)
api_classes = {
    "Geometry": GeometryWebApi,
    "SurfaceMesh": SurfaceMeshWebApi,
    "VolumeMesh": VolumeMeshWebApi,
    "Case": CaseWebApi,
}
try:
    api_class = api_classes[resource_type]
except KeyError as exc:
    raise ValueError("unsupported visualization resource type") from exc

api = api_class(resource_id)
manifest_remote = "visualize/manifest/manifest.json"
manifest_local = root / "manifest.json"
api.download_file(manifest_remote, to_file=str(manifest_local), overwrite=True)

with manifest_local.open("r", encoding="utf-8") as stream:
    entries = json.load(stream)

paths = set()
for entry in entries:
    if entry.get("type") != "SolidGeometry":
        continue
    buffers = entry.get("resources", {}).get("buffers", {})
    if buffers.get("type") == "lod":
        levels = buffers.get("levels", [])
        default = buffers.get("default", 0)
        if type(default) is not int or default < 0 or default >= len(levels):
            raise ValueError("invalid default visualization LOD")
        candidates = [levels[default]]
    else:
        candidates = [buffers]
    for candidate in candidates:
        value = candidate.get("path")
        if value:
            paths.add(value)

if not paths or len(paths) > 64:
    raise ValueError("unexpected visualization buffer count")

for value in sorted(paths):
    pure = PurePosixPath(value)
    if pure.is_absolute() or ".." in pure.parts or pure.suffix.lower() != ".bin":
        raise ValueError("unsafe visualization buffer path")
    target = root.joinpath(*pure.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    api.download_file(
        "visualize/manifest/" + pure.as_posix(),
        to_file=str(target),
        overwrite=True,
    )

print(json.dumps({"manifest": manifest_remote, "buffers": sorted(paths)}))
`
