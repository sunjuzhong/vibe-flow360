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
)

type GeometryVisualization struct {
	Manifest json.RawMessage
	Bins     map[string][]byte
}

func (c *Client) GeometryVisualization(ctx context.Context, resourceID string) (GeometryVisualization, error) {
	if err := ValidateResourcePath("Geometry", resourceID); err != nil {
		return GeometryVisualization{}, err
	}
	python, err := c.flow360Python()
	if err != nil {
		return GeometryVisualization{}, err
	}
	staging, err := os.MkdirTemp("", "vibesim-geometry-visualization-*")
	if err != nil {
		return GeometryVisualization{}, fmt.Errorf("create visualization staging directory: %w", err)
	}
	defer os.RemoveAll(staging)

	timeout := time.Duration(PreviewTimeoutSec) * time.Second
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(
		runCtx,
		python,
		"-c",
		geometryVisualizationBridge,
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
			return GeometryVisualization{}, errors.New("Geometry visualization download timed out")
		}
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return GeometryVisualization{}, fmt.Errorf("download Geometry visualization: %s", compactOutput([]byte(message)))
	}

	manifestPath := filepath.Join(staging, "manifest.json")
	manifest, err := readLimitedRegularFile(manifestPath, maxTessellationManifestSize)
	if err != nil {
		return GeometryVisualization{}, fmt.Errorf("read Geometry visualization manifest: %w", err)
	}
	binPaths, err := TessellationBinPaths(manifest)
	if err != nil {
		return GeometryVisualization{}, err
	}
	bins := make(map[string][]byte, len(binPaths))
	var totalSize int
	for _, relative := range binPaths {
		payload, err := readLimitedRegularFile(filepath.Join(staging, filepath.FromSlash(relative)), maxTessellationBinSize)
		if err != nil {
			return GeometryVisualization{}, fmt.Errorf("read Geometry visualization buffer %q: %w", relative, err)
		}
		totalSize += len(payload)
		if totalSize > MaxPreviewSize {
			return GeometryVisualization{}, fmt.Errorf("Geometry visualization exceeds %d byte limit", MaxPreviewSize)
		}
		bins[relative] = payload
	}
	return GeometryVisualization{Manifest: manifest, Bins: bins}, nil
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
	if !json.Valid(manifest) {
		return nil, errors.New("Geometry visualization manifest is invalid JSON")
	}
	var entries []map[string]any
	if err := json.Unmarshal(manifest, &entries); err != nil {
		return nil, errors.New("Geometry visualization manifest must be a JSON array")
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
		return nil, errors.New("Geometry visualization manifest does not reference a binary buffer")
	}
	if len(paths) > MaxPreviewFiles {
		return nil, fmt.Errorf("Geometry visualization references more than %d buffers", MaxPreviewFiles)
	}
	result := make([]string, 0, len(paths))
	for path := range paths {
		result = append(result, path)
	}
	sortStrings(result)
	return result, nil
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

const geometryVisualizationBridge = `
import json
import os
from pathlib import Path, PurePosixPath
import sys

from flow360.component.simulation.web.asset_webapi import GeometryWebApi
from flow360.environment import Env, EnvironmentConfig

geometry_id, output_dir, environment = sys.argv[1:4]
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
api = GeometryWebApi(geometry_id)
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
    candidates = buffers.get("levels", []) if buffers.get("type") == "lod" else [buffers]
    for candidate in candidates:
        value = candidate.get("path")
        if value:
            paths.add(value)

if not paths or len(paths) > 10:
    raise ValueError("unexpected Geometry visualization buffer count")

for value in sorted(paths):
    pure = PurePosixPath(value)
    if pure.is_absolute() or ".." in pure.parts or pure.suffix.lower() != ".bin":
        raise ValueError("unsafe Geometry visualization buffer path")
    target = root.joinpath(*pure.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    api.download_file(
        "visualize/manifest/" + pure.as_posix(),
        to_file=str(target),
        overwrite=True,
    )

print(json.dumps({"manifest": manifest_remote, "buffers": sorted(paths)}))
`
