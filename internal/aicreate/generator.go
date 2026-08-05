package aicreate

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

//go:embed assets/generate_cad.py
var cadGeneratorScript []byte

type GeometryValidation struct {
	SolidCount           int       `json:"solid_count"`
	FaceCount            int       `json:"face_count"`
	Volume               float64   `json:"volume"`
	Bounds               []float64 `json:"bounds"`
	Kernel               string    `json:"kernel"`
	BodyNames            []string  `json:"body_names,omitempty"`
	FaceNames            []string  `json:"face_names,omitempty"`
	FaceCoverageChecked  bool      `json:"face_coverage_checked,omitempty"`
	NamedFaceCount       int       `json:"named_face_count,omitempty"`
	UnnamedFaceCount     int       `json:"unnamed_face_count,omitempty"`
	OverlappingFaceCount int       `json:"overlapping_face_count,omitempty"`
}

type Generator interface {
	Generate(context.Context, Geometry, string) (GeometryValidation, error)
}

type GenerationFailureKind string

const (
	GenerationRuntimeFailure   GenerationFailureKind = "runtime"
	GenerationTemporaryFailure GenerationFailureKind = "temporary"
	GenerationGeometryFailure  GenerationFailureKind = "geometry"
)

type GenerationError struct {
	Kind GenerationFailureKind
	Err  error
}

func (e *GenerationError) Error() string { return e.Err.Error() }
func (e *GenerationError) Unwrap() error { return e.Err }

func GenerationFailure(err error) GenerationFailureKind {
	var generationError *GenerationError
	if errors.As(err, &generationError) {
		return generationError.Kind
	}
	return GenerationGeometryFailure
}

type CadQueryGenerator struct {
	UVBinary string
	CacheDir string
	Timeout  time.Duration
	Offline  bool
}

func NewCadQueryGenerator() *CadQueryGenerator {
	timeout := 90 * time.Second
	if raw := strings.TrimSpace(os.Getenv("VIBESIM_CAD_TIMEOUT_SECONDS")); raw != "" {
		if seconds, err := strconv.Atoi(raw); err == nil && seconds >= 5 && seconds <= 600 {
			timeout = time.Duration(seconds) * time.Second
		}
	}
	cacheDir := strings.TrimSpace(os.Getenv("VIBESIM_UV_CACHE_DIR"))
	if cacheDir == "" {
		if userHome, err := os.UserHomeDir(); err == nil {
			cacheDir = filepath.Join(userHome, ".cache", "uv")
		}
	}
	return &CadQueryGenerator{
		UVBinary: firstNonEmpty(os.Getenv("VIBESIM_UV_BINARY"), "uv"),
		CacheDir: cacheDir,
		Timeout:  timeout,
		Offline:  strings.EqualFold(strings.TrimSpace(os.Getenv("VIBESIM_CAD_OFFLINE")), "true"),
	}
}

func (g *CadQueryGenerator) Generate(ctx context.Context, geometry Geometry, outputPath string) (GeometryValidation, error) {
	var validation GeometryValidation
	if err := validateGeometry(geometry); err != nil {
		return validation, err
	}
	if strings.ToLower(filepath.Ext(outputPath)) != ".step" {
		return validation, errors.New("CAD output path must use the .step extension")
	}
	absoluteOutputPath, err := filepath.Abs(outputPath)
	if err != nil {
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("resolve CAD output path: %w", err)}
	}
	outputPath = filepath.Clean(absoluteOutputPath)
	uvBinary, err := exec.LookPath(g.UVBinary)
	if err != nil {
		return validation, &GenerationError{Kind: GenerationRuntimeFailure, Err: fmt.Errorf("CAD runtime %q was not found; install uv or configure VIBESIM_UV_BINARY", g.UVBinary)}
	}
	if strings.ContainsRune(uvBinary, filepath.Separator) {
		if absoluteUV, absoluteErr := filepath.Abs(uvBinary); absoluteErr == nil {
			uvBinary = absoluteUV
		}
	}
	directory, err := os.MkdirTemp("", "vibesim-cad-runtime-")
	if err != nil {
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("prepare CAD runtime: %w", err)}
	}
	defer os.RemoveAll(directory)
	recipePath := filepath.Join(directory, "recipe.json")
	scriptPath := filepath.Join(directory, "generate_cad.py")
	recipe, err := json.Marshal(geometry)
	if err != nil {
		return validation, err
	}
	if err := os.WriteFile(recipePath, recipe, 0o600); err != nil {
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("write CAD recipe: %w", err)}
	}
	if err := os.WriteFile(scriptPath, cadGeneratorScript, 0o500); err != nil {
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("write CAD generator: %w", err)}
	}

	runCtx, cancel := context.WithTimeout(ctx, g.Timeout)
	defer cancel()
	args := []string{"run", "--no-project"}
	if g.Offline {
		args = append(args, "--offline")
	}
	args = append(args, "--with", "cadquery==2.6.1", "python", scriptPath, recipePath, outputPath)
	command := exec.CommandContext(runCtx, uvBinary, args...)
	command.Dir = directory
	command.Env = []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + directory,
		"TMPDIR=" + directory,
		"UV_NO_PROGRESS=1",
	}
	if g.CacheDir != "" {
		command.Env = append(command.Env, "UV_CACHE_DIR="+g.CacheDir)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err = command.Run()
	if err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("CAD generation timed out after %s", g.Timeout)}
		}
		return validation, &GenerationError{Kind: classifyCADExecutionFailure(stderr.String()), Err: fmt.Errorf("CAD generation failed: %s", truncateOutput(stderr.Bytes(), 1200))}
	}
	if err := json.Unmarshal(stdout.Bytes(), &validation); err != nil {
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("CAD generator returned invalid validation data: %w: %s", err, truncateOutput(stdout.Bytes(), 600))}
	}
	if validation.SolidCount < 1 || validation.FaceCount < 1 || validation.Volume <= 0 {
		return validation, &GenerationError{Kind: GenerationGeometryFailure, Err: fmt.Errorf("CAD topology validation failed: solids=%d faces=%d volume=%g", validation.SolidCount, validation.FaceCount, validation.Volume)}
	}
	if validation.FaceCoverageChecked && (validation.UnnamedFaceCount != 0 || validation.OverlappingFaceCount != 0 || validation.NamedFaceCount != validation.FaceCount) {
		return validation, &GenerationError{Kind: GenerationGeometryFailure, Err: fmt.Errorf(
			"Flow360 boundary coverage validation failed: %d of %d faces are named, %d are unnamed, and %d have overlapping assignments; every result face must be assigned exactly one semantic boundary name",
			validation.NamedFaceCount, validation.FaceCount, validation.UnnamedFaceCount, validation.OverlappingFaceCount,
		)}
	}
	return validation, nil
}

func classifyCADExecutionFailure(stderr string) GenerationFailureKind {
	message := strings.ToLower(stderr)
	switch {
	case strings.Contains(message, "generate_cad.py") && (strings.Contains(message, "no such file") || strings.Contains(message, "can't open file")):
		return GenerationTemporaryFailure
	case strings.Contains(message, "failed to download"), strings.Contains(message, "name resolution"), strings.Contains(message, "connection reset"), strings.Contains(message, "timed out"):
		return GenerationTemporaryFailure
	case strings.Contains(message, "no module named") && strings.Contains(message, "cadquery"):
		return GenerationRuntimeFailure
	default:
		return GenerationGeometryFailure
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func truncateOutput(data []byte, limit int) string {
	text := strings.TrimSpace(string(data))
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "…"
}
