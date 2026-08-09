package flow360

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	// Case manifests include result-field and boundary metadata and can exceed
	// the original 2 MiB Geometry-oriented limit. Keep the cap bounded while
	// matching the browser loader so large Cases remain renderable.
	maxTessellationManifestSize = 8 * 1024 * 1024
	maxTessellationEntries      = 100_000
	maxTessellationFiles        = 64
	maxSurfaceMeshFallbackSize  = 512 * 1024 * 1024
	visualizationTimeout        = 30 * time.Minute
)

type ResourceVisualization struct {
	Manifest json.RawMessage
	Bins     map[string][]byte
	Files    map[string]string
	Catalog  VisualizationCatalog
	cleanup  func()
}

type VisualizationFile struct {
	Path    string
	cleanup func()
}

func (f *VisualizationFile) Close() {
	if f.cleanup != nil {
		f.cleanup()
		f.cleanup = nil
	}
}

func (v *ResourceVisualization) Close() {
	if v.cleanup != nil {
		v.cleanup()
		v.cleanup = nil
	}
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

func (c *Client) ResourceVisualizationAsset(
	ctx context.Context,
	resourceType string,
	resourceID string,
	relative string,
) (VisualizationFile, error) {
	if err := ValidateResourcePath(resourceType, resourceID); err != nil {
		return VisualizationFile{}, visualizationError(VisualizationInvalid, resourceType, err)
	}
	clean, err := ValidateVisualizationBufferPath(relative)
	if err != nil {
		return VisualizationFile{}, visualizationError(VisualizationInvalid, resourceType, err)
	}
	python, err := c.flow360Python()
	if err != nil {
		return VisualizationFile{}, visualizationError(VisualizationUnavailable, resourceType, err)
	}
	staging, err := os.MkdirTemp("", "vibesim-visualization-asset-*")
	if err != nil {
		return VisualizationFile{}, visualizationError(VisualizationDownload, resourceType, err)
	}
	runCtx, cancel := context.WithTimeout(ctx, visualizationTimeout)
	defer cancel()
	command := exec.CommandContext(
		runCtx, python, "-c", resourceVisualizationAssetBridge,
		resourceType, resourceID, staging, strings.TrimSpace(c.Environment), clean,
	)
	command.Env = append(os.Environ(), "SIMCLOUD_PROFILE="+strings.TrimSpace(c.Profile))
	if c.APIKey != "" {
		command.Env = append(command.Env, "FLOW360_APIKEY="+c.APIKey)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if _, err := command.Output(); err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			_ = os.RemoveAll(staging)
			return VisualizationFile{}, visualizationError(VisualizationTimeout, resourceType, errors.New("download timed out"))
		}
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		if resourceType != "SurfaceMesh" || c.rebuildSurfaceMeshVisualizationAsset(runCtx, python, resourceID, staging, clean) != nil {
			_ = os.RemoveAll(staging)
			return VisualizationFile{}, visualizationError(VisualizationDownload, resourceType, errors.New(compactOutput([]byte(message))))
		}
	}
	path := filepath.Join(staging, filepath.FromSlash(clean))
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		_ = os.RemoveAll(staging)
		return VisualizationFile{}, visualizationError(VisualizationMalformed, resourceType, errors.New("downloaded buffer is not a regular file"))
	}
	return VisualizationFile{Path: path, cleanup: func() { _ = os.RemoveAll(staging) }}, nil
}

func (c *Client) rebuildSurfaceMeshVisualizationAsset(
	ctx context.Context,
	python string,
	resourceID string,
	staging string,
	relative string,
) error {
	command := exec.CommandContext(
		ctx,
		python,
		"-c",
		surfaceMeshVisualizationSourceBridge,
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
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return errors.New(compactOutput([]byte(message)))
	}
	return synthesizeSurfaceMeshVisualizationAsset(
		filepath.Join(staging, "fallback-manifest.json"),
		filepath.Join(staging, "surfaceAll.stl"),
		relative,
		filepath.Join(staging, filepath.FromSlash(relative)),
	)
}

type visualizationBufferSection struct {
	Name      string `json:"name"`
	DType     string `json:"dType"`
	Dimension int    `json:"dimension"`
	Length    int64  `json:"length"`
	Offset    int64  `json:"offset"`
}

type visualizationBufferDescriptor struct {
	Path     string                       `json:"path"`
	Sections []visualizationBufferSection `json:"sections"`
}

func synthesizeSurfaceMeshVisualizationAsset(manifestPath, stlPath, relative, target string) error {
	manifest, err := readLimitedRegularFile(manifestPath, maxTessellationManifestSize)
	if err != nil {
		return fmt.Errorf("read fallback manifest: %w", err)
	}
	descriptor, err := visualizationDescriptorForPath(manifest, relative)
	if err != nil {
		return err
	}
	stl, err := readLimitedRegularFile(stlPath, maxSurfaceMeshFallbackSize)
	if err != nil {
		return fmt.Errorf("read SurfaceMesh STL: %w", err)
	}
	if len(stl) < 84 {
		return errors.New("SurfaceMesh STL is not a binary STL")
	}
	triangleCount := uint64(binary.LittleEndian.Uint32(stl[80:84]))
	expectedSTLBytes := uint64(84) + triangleCount*50
	if expectedSTLBytes != uint64(len(stl)) {
		return errors.New("SurfaceMesh STL is malformed or is not binary")
	}
	if triangleCount > uint64(maxSurfaceMeshFallbackSize/50) {
		return errors.New("SurfaceMesh STL has too many triangles")
	}

	var outputBytes int64
	for _, section := range descriptor.Sections {
		if section.Offset < 0 || section.Length <= 0 || section.Offset > int64(maxSurfaceMeshFallbackSize)-section.Length {
			return fmt.Errorf("invalid UVF section %q", section.Name)
		}
		if end := section.Offset + section.Length; end > outputBytes {
			outputBytes = end
		}
	}
	if outputBytes <= 0 || outputBytes > int64(maxSurfaceMeshFallbackSize) {
		return errors.New("synthesized UVF buffer size is invalid")
	}
	output := make([]byte, int(outputBytes))
	expectedPositionBytes := int64(triangleCount * 9 * 4)
	expectedScalarBytes := int64(triangleCount * 3 * 4)

	for _, section := range descriptor.Sections {
		switch {
		case section.Name == "position":
			if section.DType != "float32" || section.Dimension != 3 || section.Length != expectedPositionBytes {
				return errors.New("SurfaceMesh STL does not match the UVF position section")
			}
			for triangle := uint64(0); triangle < triangleCount; triangle++ {
				source := 84 + triangle*50 + 12
				destination := uint64(section.Offset) + triangle*36
				copy(output[destination:destination+36], stl[source:source+36])
			}
		case surfaceMeshQualityField(section.Name):
			if section.DType != "float32" || section.Dimension != 1 || section.Length != expectedScalarBytes {
				return fmt.Errorf("SurfaceMesh STL does not match UVF field %q", section.Name)
			}
			for triangle := uint64(0); triangle < triangleCount; triangle++ {
				value := surfaceMeshTriangleMetric(stl, triangle, section.Name)
				for vertex := uint64(0); vertex < 3; vertex++ {
					offset := uint64(section.Offset) + (triangle*3+vertex)*4
					binary.LittleEndian.PutUint32(output[offset:offset+4], math.Float32bits(float32(value)))
				}
			}
		default:
			return fmt.Errorf("cannot rebuild SurfaceMesh UVF section %q", section.Name)
		}
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(target, output, 0o600); err != nil {
		return fmt.Errorf("write synthesized SurfaceMesh UVF: %w", err)
	}
	return nil
}

func visualizationDescriptorForPath(manifest json.RawMessage, relative string) (visualizationBufferDescriptor, error) {
	var entries []struct {
		Type      string `json:"type"`
		Resources struct {
			Buffers struct {
				Type     string                          `json:"type"`
				Path     string                          `json:"path"`
				Sections []visualizationBufferSection    `json:"sections"`
				Levels   []visualizationBufferDescriptor `json:"levels"`
			} `json:"buffers"`
		} `json:"resources"`
	}
	if err := json.Unmarshal(manifest, &entries); err != nil {
		return visualizationBufferDescriptor{}, errors.New("fallback visualization manifest is invalid")
	}
	for _, entry := range entries {
		if entry.Type != "SolidGeometry" {
			continue
		}
		if entry.Resources.Buffers.Type == "lod" {
			for _, level := range entry.Resources.Buffers.Levels {
				if level.Path == relative {
					return level, nil
				}
			}
			continue
		}
		if entry.Resources.Buffers.Path == relative {
			return visualizationBufferDescriptor{
				Path: relative, Sections: entry.Resources.Buffers.Sections,
			}, nil
		}
	}
	return visualizationBufferDescriptor{}, fmt.Errorf("visualization manifest does not describe %q", relative)
}

func surfaceMeshQualityField(name string) bool {
	switch name {
	case "Area", "Aspect Ratio", "Incircle/Circumcircle Radius Ratio Quality",
		"Maximum Angle", "Minimum Angle", "Minimum Edge Length", "Skewness Quality":
		return true
	default:
		return false
	}
}

func surfaceMeshTriangleMetric(stl []byte, triangle uint64, name string) float64 {
	base := 84 + triangle*50 + 12
	point := func(index uint64) [3]float64 {
		offset := base + index*12
		return [3]float64{
			float64(math.Float32frombits(binary.LittleEndian.Uint32(stl[offset : offset+4]))),
			float64(math.Float32frombits(binary.LittleEndian.Uint32(stl[offset+4 : offset+8]))),
			float64(math.Float32frombits(binary.LittleEndian.Uint32(stl[offset+8 : offset+12]))),
		}
	}
	p0, p1, p2 := point(0), point(1), point(2)
	distance := func(a, b [3]float64) float64 {
		x, y, z := a[0]-b[0], a[1]-b[1], a[2]-b[2]
		return math.Sqrt(x*x + y*y + z*z)
	}
	a, b, c := distance(p1, p2), distance(p2, p0), distance(p0, p1)
	minimumEdge := math.Min(a, math.Min(b, c))
	maximumEdge := math.Max(a, math.Max(b, c))
	x1, y1, z1 := p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]
	x2, y2, z2 := p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]
	crossX, crossY, crossZ := y1*z2-z1*y2, z1*x2-x1*z2, x1*y2-y1*x2
	area := 0.5 * math.Sqrt(crossX*crossX+crossY*crossY+crossZ*crossZ)
	semiPerimeter := (a + b + c) / 2
	if area <= 0 || semiPerimeter <= 0 || minimumEdge <= 0 {
		if name == "Aspect Ratio" {
			return math.MaxFloat32
		}
		return 0
	}
	angle := func(opposite, adjacent1, adjacent2 float64) float64 {
		cosine := (adjacent1*adjacent1 + adjacent2*adjacent2 - opposite*opposite) / (2 * adjacent1 * adjacent2)
		cosine = math.Max(-1, math.Min(1, cosine))
		return math.Acos(cosine) * 180 / math.Pi
	}
	angleA, angleB, angleC := angle(a, b, c), angle(b, c, a), angle(c, a, b)
	minimumAngle := math.Min(angleA, math.Min(angleB, angleC))
	maximumAngle := math.Max(angleA, math.Max(angleB, angleC))
	inradius := area / semiPerimeter
	circumradius := a * b * c / (4 * area)
	skewness := 1 - math.Max((maximumAngle-60)/120, (60-minimumAngle)/60)
	skewness = math.Max(0, math.Min(1, skewness))
	switch name {
	case "Area":
		return area
	case "Aspect Ratio":
		return maximumEdge / (2 * math.Sqrt(3) * inradius)
	case "Incircle/Circumcircle Radius Ratio Quality":
		return 2 * inradius / circumradius
	case "Maximum Angle":
		return maximumAngle
	case "Minimum Angle":
		return minimumAngle
	case "Minimum Edge Length":
		return minimumEdge
	case "Skewness Quality":
		return skewness
	default:
		return 0
	}
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
	keepStaging := false
	defer func() {
		if !keepStaging {
			_ = os.RemoveAll(staging)
		}
	}()

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
	manifest, err = NormalizeVisualizationManifest(manifest)
	if err != nil {
		return ResourceVisualization{}, visualizationError(VisualizationMalformed, resourceType, err)
	}
	binPaths, err := TessellationDefaultBinPaths(manifest)
	if err != nil {
		return ResourceVisualization{}, visualizationError(VisualizationMalformed, resourceType, err)
	}
	catalog, err := ParseVisualizationCatalog(manifest)
	if err != nil {
		return ResourceVisualization{}, visualizationError(VisualizationMalformed, resourceType, err)
	}
	files := make(map[string]string, len(binPaths))
	for _, relative := range binPaths {
		path := filepath.Join(staging, filepath.FromSlash(relative))
		info, err := os.Lstat(path)
		if err != nil {
			return ResourceVisualization{}, visualizationError(
				VisualizationMalformed,
				resourceType,
				fmt.Errorf("inspect buffer %q: %w", relative, err),
			)
		}
		if !info.Mode().IsRegular() {
			return ResourceVisualization{}, visualizationError(
				VisualizationMalformed,
				resourceType,
				fmt.Errorf("buffer %q is not a regular file", relative),
			)
		}
		files[relative] = path
	}
	keepStaging = true
	return ResourceVisualization{
		Manifest: manifest,
		Files:    files,
		Catalog:  catalog,
		cleanup:  func() { _ = os.RemoveAll(staging) },
	}, nil
}

// Some Case manifests contain placeholder SolidGeometry records without a
// browser buffer alongside the renderable result surfaces. They are valid
// Flow360 metadata but not valid UVF render objects. Remove only those empty
// placeholders (and their directly attributed children) before the manifest
// reaches the strict browser loader; unsafe or malformed paths still fail.
func NormalizeVisualizationManifest(manifest json.RawMessage) (json.RawMessage, error) {
	var entries []map[string]any
	if !json.Valid(manifest) || json.Unmarshal(manifest, &entries) != nil {
		return nil, errors.New("visualization manifest must be a JSON array")
	}
	if len(entries) == 0 || len(entries) > maxTessellationEntries {
		return nil, errors.New("visualization manifest has an invalid entry count")
	}
	invalidSolids := map[string]struct{}{}
	renderableSolids := 0
	for _, entry := range entries {
		if entry["type"] != "SolidGeometry" {
			continue
		}
		id, _ := entry["id"].(string)
		resources, _ := entry["resources"].(map[string]any)
		buffers, _ := resources["buffers"].(map[string]any)
		if buffers == nil {
			invalidSolids[id] = struct{}{}
			continue
		}
		selected, err := defaultTessellationBuffer(buffers)
		if err != nil {
			return nil, fmt.Errorf("object %q: %w", id, err)
		}
		path, hasPath := selected["path"].(string)
		if !hasPath || strings.TrimSpace(path) == "" {
			invalidSolids[id] = struct{}{}
			continue
		}
		if _, err := ValidateVisualizationBufferPath(path); err != nil {
			return nil, fmt.Errorf("object %q: %w", id, err)
		}
		renderableSolids++
	}
	if renderableSolids == 0 {
		return nil, errors.New("visualization manifest has no renderable objects")
	}
	filtered := make([]map[string]any, 0, len(entries)-len(invalidSolids))
	for _, entry := range entries {
		id, _ := entry["id"].(string)
		if _, invalid := invalidSolids[id]; invalid && entry["type"] == "SolidGeometry" {
			continue
		}
		attributions, _ := entry["attributions"].(map[string]any)
		parentID, _ := attributions["packedParentId"].(string)
		if _, invalidParent := invalidSolids[parentID]; invalidParent {
			continue
		}
		filtered = append(filtered, entry)
	}
	changed := len(filtered) != len(entries)
	filtered, referencesChanged := pruneVisualizationReferences(filtered)
	if !changed && !referencesChanged {
		return manifest, nil
	}
	encoded, err := json.Marshal(filtered)
	if err != nil {
		return nil, fmt.Errorf("encode normalized visualization manifest: %w", err)
	}
	if len(encoded) > maxTessellationManifestSize {
		return nil, fmt.Errorf("normalized visualization manifest exceeds %d byte limit", maxTessellationManifestSize)
	}
	return encoded, nil
}

// pruneVisualizationReferences keeps the manifest graph internally consistent
// after placeholder geometry is removed. Empty GeometryGroups are removed
// recursively, because retaining one would leave its parent with a container
// that can never produce a renderable object.
func pruneVisualizationReferences(entries []map[string]any) ([]map[string]any, bool) {
	anyChanged := false
	for {
		ids := make(map[string]struct{}, len(entries))
		for _, entry := range entries {
			if id, ok := entry["id"].(string); ok && id != "" {
				ids[id] = struct{}{}
			}
		}

		changed := false
		filtered := make([]map[string]any, 0, len(entries))
		for _, entry := range entries {
			attributions, _ := entry["attributions"].(map[string]any)
			if attributions != nil {
				if parentID, ok := attributions["packedParentId"].(string); ok && parentID != "" {
					if _, exists := ids[parentID]; !exists {
						changed = true
						continue
					}
				}
				for _, key := range []string{"members", "faces", "edges", "vertices"} {
					references, exists := attributions[key].([]any)
					if !exists {
						continue
					}
					kept := make([]any, 0, len(references))
					for _, reference := range references {
						id, ok := reference.(string)
						if !ok {
							kept = append(kept, reference)
							continue
						}
						if _, exists := ids[id]; exists {
							kept = append(kept, reference)
						} else {
							changed = true
						}
					}
					attributions[key] = kept
				}
				if entry["type"] == "GeometryGroup" {
					if members, exists := attributions["members"].([]any); exists && len(members) == 0 {
						changed = true
						continue
					}
				}
			}
			filtered = append(filtered, entry)
		}
		entries = filtered
		anyChanged = anyChanged || changed
		if !changed {
			return entries, anyChanged
		}
	}
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
	clean, err := ValidateVisualizationBufferPath(path)
	if err != nil {
		return err
	}
	paths[clean] = struct{}{}
	return nil
}

func ValidateVisualizationBufferPath(path string) (string, error) {
	if strings.Contains(path, "\\") {
		return "", errors.New("Geometry visualization buffer path must use forward slashes")
	}
	path = strings.TrimSpace(path)
	clean := filepath.ToSlash(filepath.Clean(path))
	if path == "" || clean != path || strings.HasPrefix(clean, "/") || strings.Contains(clean, "..") {
		return "", errors.New("Geometry visualization buffer path is unsafe")
	}
	if !strings.HasSuffix(strings.ToLower(clean), ".bin") {
		return "", errors.New("Geometry visualization buffer must use the .bin extension")
	}
	return clean, nil
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

const resourceVisualizationAssetBridge = `
import sys
from pathlib import Path, PurePosixPath

from flow360.component.simulation.web.asset_webapi import (
    CaseWebApi,
    GeometryWebApi,
    SurfaceMeshWebApi,
    VolumeMeshWebApi,
)
from flow360.environment import Env, EnvironmentConfig

resource_type, resource_id, output_dir, environment, relative = sys.argv[1:6]
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

pure = PurePosixPath(relative)
if pure.is_absolute() or ".." in pure.parts or pure.suffix.lower() != ".bin":
    raise ValueError("unsafe visualization buffer path")
target = Path(output_dir).joinpath(*pure.parts)
target.parent.mkdir(parents=True, exist_ok=True)
api_class(resource_id).download_file(
    "visualize/manifest/" + pure.as_posix(),
    to_file=str(target),
    overwrite=True,
)
`

const surfaceMeshVisualizationSourceBridge = `
import sys
from pathlib import Path

from flow360.component.simulation.web.asset_webapi import SurfaceMeshWebApi
from flow360.environment import Env, EnvironmentConfig

resource_id, output_dir, environment = sys.argv[1:4]
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
api = SurfaceMeshWebApi(resource_id)
api.download_file(
    "visualize/manifest/manifest.json",
    to_file=str(root / "fallback-manifest.json"),
    overwrite=True,
)
api.download_file(
    "surfaceAll.stl",
    to_file=str(root / "surfaceAll.stl"),
    overwrite=True,
)
`
