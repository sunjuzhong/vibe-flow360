package aicreate

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

//go:embed assets/generate_cad.py
var cadGeneratorScript []byte

//go:embed assets/validate_step.py
var stepValidatorScript []byte

//go:embed assets/preview_step.py
var stepPreviewScript []byte

//go:embed assets/thumbnail_step.py
var stepThumbnailScript []byte

type GeometryValidation struct {
	SolidCount           int                   `json:"solid_count"`
	FaceCount            int                   `json:"face_count"`
	Volume               float64               `json:"volume"`
	Bounds               []float64             `json:"bounds"`
	Kernel               string                `json:"kernel"`
	LengthUnit           string                `json:"length_unit,omitempty"`
	BodyNames            []string              `json:"body_names,omitempty"`
	FaceNames            []string              `json:"face_names,omitempty"`
	FaceCoverageChecked  bool                  `json:"face_coverage_checked,omitempty"`
	NamedFaceCount       int                   `json:"named_face_count,omitempty"`
	UnnamedFaceCount     int                   `json:"unnamed_face_count,omitempty"`
	OverlappingFaceCount int                   `json:"overlapping_face_count,omitempty"`
	OperationDiagnostics []OperationDiagnostic `json:"operation_diagnostics,omitempty"`
}

type OperationDiagnostic struct {
	ID         string    `json:"id"`
	Operation  string    `json:"operation"`
	Valid      bool      `json:"valid"`
	SolidCount int       `json:"solid_count"`
	FaceCount  int       `json:"face_count"`
	Volume     float64   `json:"volume"`
	Bounds     []float64 `json:"bounds,omitempty"`
}

type CADDiagnostic struct {
	Code               string                         `json:"code"`
	OperationID        string                         `json:"operation_id"`
	Operation          string                         `json:"operation"`
	Message            string                         `json:"message"`
	DomainRelationship string                         `json:"domain_relationship,omitempty"`
	AxisRelationships  []string                       `json:"axis_relationships,omitempty"`
	Result             *OperationDiagnostic           `json:"result,omitempty"`
	Operands           map[string]OperationDiagnostic `json:"operands,omitempty"`
}

type Generator interface {
	Generate(context.Context, Geometry, string) (GeometryValidation, error)
}

type STEPValidator interface {
	ValidateSTEP(context.Context, string) (GeometryValidation, error)
}

type STEPPreview struct {
	Vertices  int       `json:"vertices"`
	Triangles int       `json:"triangles"`
	Bounds    []float64 `json:"bounds"`
}

type STEPPreviewer interface {
	PreviewSTEP(context.Context, []string, string) (STEPPreview, error)
}

type STEPThumbnailer interface {
	ThumbnailSTEP(context.Context, string, string) error
}

type GenerationFailureKind string

const (
	GenerationRuntimeFailure   GenerationFailureKind = "runtime"
	GenerationTemporaryFailure GenerationFailureKind = "temporary"
	GenerationGeometryFailure  GenerationFailureKind = "geometry"
)

type GenerationError struct {
	Kind       GenerationFailureKind
	Err        error
	Diagnostic *CADDiagnostic
}

func (e *GenerationError) Error() string {
	if e.Diagnostic != nil {
		if payload, err := json.Marshal(e.Diagnostic); err == nil {
			return "CAD_DIAGNOSTIC " + string(payload)
		}
	}
	return e.Err.Error()
}
func (e *GenerationError) Unwrap() error { return e.Err }

func GenerationFailure(err error) GenerationFailureKind {
	var generationError *GenerationError
	if errors.As(err, &generationError) {
		return generationError.Kind
	}
	return GenerationGeometryFailure
}

func GenerationDiagnostic(err error) *CADDiagnostic {
	var generationError *GenerationError
	if errors.As(err, &generationError) {
		return generationError.Diagnostic
	}
	return nil
}

type CadQueryGenerator struct {
	UVBinary  string
	Python    string
	CacheDir  string
	PythonDir string
	Timeout   time.Duration
	Offline   bool
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
		// An empty value enables deterministic runtime discovery. Services such
		// as launchd commonly have a narrower PATH than an interactive shell.
		UVBinary:  strings.TrimSpace(os.Getenv("VIBESIM_UV_BINARY")),
		Python:    firstConfigured(os.Getenv("VIBESIM_CAD_PYTHON"), "3.11"),
		CacheDir:  cacheDir,
		PythonDir: strings.TrimSpace(os.Getenv("VIBESIM_UV_PYTHON_INSTALL_DIR")),
		Timeout:   timeout,
		Offline:   strings.EqualFold(strings.TrimSpace(os.Getenv("VIBESIM_CAD_OFFLINE")), "true"),
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
	uvBinary, err := resolveCADRuntimeBinary(g.UVBinary)
	if err != nil {
		return validation, &GenerationError{Kind: GenerationRuntimeFailure, Err: err}
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
	python := firstConfigured(g.Python, "3.11")
	args = append(args, "--python", python, "--with", "cadquery==2.6.1", "python", scriptPath, recipePath, outputPath)
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
	if g.PythonDir != "" {
		command.Env = append(command.Env, "UV_PYTHON_INSTALL_DIR="+g.PythonDir)
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
		return validation, &GenerationError{
			Kind: classifyCADExecutionFailure(stderr.String()), Err: fmt.Errorf("CAD generation failed: %s", truncateOutput(stderr.Bytes(), 1200)),
			Diagnostic: parseCADDiagnostic(stderr.String()),
		}
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

func (g *CadQueryGenerator) ValidateSTEP(ctx context.Context, inputPath string) (GeometryValidation, error) {
	var validation GeometryValidation
	absoluteInputPath, err := filepath.Abs(inputPath)
	if err != nil {
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("resolve STEP path: %w", err)}
	}
	inputPath = filepath.Clean(absoluteInputPath)
	extension := strings.ToLower(filepath.Ext(inputPath))
	if extension != ".step" && extension != ".stp" {
		return validation, &GenerationError{Kind: GenerationGeometryFailure, Err: errors.New("CAD input path must use the .step or .stp extension")}
	}
	if info, statErr := os.Stat(inputPath); statErr != nil || !info.Mode().IsRegular() {
		if statErr == nil {
			statErr = errors.New("path is not a regular file")
		}
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("read STEP input: %w", statErr)}
	}
	uvBinary, err := resolveCADRuntimeBinary(g.UVBinary)
	if err != nil {
		return validation, &GenerationError{Kind: GenerationRuntimeFailure, Err: err}
	}
	directory, err := os.MkdirTemp("", "vibesim-step-validation-")
	if err != nil {
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("prepare STEP validator: %w", err)}
	}
	defer os.RemoveAll(directory)
	scriptPath := filepath.Join(directory, "validate_step.py")
	if err := os.WriteFile(scriptPath, stepValidatorScript, 0o500); err != nil {
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("write STEP validator: %w", err)}
	}

	runCtx, cancel := context.WithTimeout(ctx, g.Timeout)
	defer cancel()
	args := []string{"run", "--no-project"}
	if g.Offline {
		args = append(args, "--offline")
	}
	args = append(args, "--python", firstConfigured(g.Python, "3.11"), "--with", "cadquery==2.6.1", "python", scriptPath, inputPath)
	command := exec.CommandContext(runCtx, uvBinary, args...)
	command.Dir = directory
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + directory, "TMPDIR=" + directory, "UV_NO_PROGRESS=1"}
	if g.CacheDir != "" {
		command.Env = append(command.Env, "UV_CACHE_DIR="+g.CacheDir)
	}
	if g.PythonDir != "" {
		command.Env = append(command.Env, "UV_PYTHON_INSTALL_DIR="+g.PythonDir)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("STEP validation timed out after %s", g.Timeout)}
		}
		return validation, &GenerationError{Kind: classifyCADExecutionFailure(stderr.String()), Err: fmt.Errorf("STEP validation failed: %s", truncateOutput(stderr.Bytes(), 1200))}
	}
	if err := json.Unmarshal(stdout.Bytes(), &validation); err != nil {
		return validation, &GenerationError{Kind: GenerationTemporaryFailure, Err: fmt.Errorf("STEP validator returned invalid data: %w: %s", err, truncateOutput(stdout.Bytes(), 600))}
	}
	if validation.SolidCount < 1 || validation.FaceCount < 1 || validation.Volume <= 0 {
		return validation, &GenerationError{Kind: GenerationGeometryFailure, Err: fmt.Errorf("STEP topology validation failed: solids=%d faces=%d volume=%g", validation.SolidCount, validation.FaceCount, validation.Volume)}
	}
	return validation, nil
}

func (g *CadQueryGenerator) PreviewSTEP(ctx context.Context, inputPaths []string, outputPath string) (STEPPreview, error) {
	var preview STEPPreview
	if len(inputPaths) < 1 || len(inputPaths) > 2 {
		return preview, errors.New("STEP preview requires one or two versions")
	}
	absoluteOutputPath, err := filepath.Abs(outputPath)
	if err != nil {
		return preview, fmt.Errorf("resolve STEP preview output: %w", err)
	}
	outputPath = filepath.Clean(absoluteOutputPath)
	directory, err := os.MkdirTemp("", "vibesim-step-preview-")
	if err != nil {
		return preview, err
	}
	defer os.RemoveAll(directory)
	scriptPath := filepath.Join(directory, "preview_step.py")
	if err := os.WriteFile(scriptPath, stepPreviewScript, 0o500); err != nil {
		return preview, err
	}
	stagedInputs := make([]string, 0, len(inputPaths))
	for index, inputPath := range inputPaths {
		stagedPath := filepath.Join(directory, fmt.Sprintf("input-%d.step", index+1))
		if err := copySTEPInput(inputPath, stagedPath); err != nil {
			return preview, fmt.Errorf("stage STEP preview input: %w", err)
		}
		stagedInputs = append(stagedInputs, stagedPath)
	}
	uvBinary, err := resolveCADRuntimeBinary(g.UVBinary)
	if err != nil {
		return preview, err
	}
	args := []string{"run", "--no-project"}
	if g.Offline {
		args = append(args, "--offline")
	}
	args = append(args, "--python", firstConfigured(g.Python, "3.11"), "--with", "cadquery==2.6.1", "python", scriptPath, outputPath)
	args = append(args, stagedInputs...)
	runCtx, cancel := context.WithTimeout(ctx, g.Timeout)
	defer cancel()
	command := exec.CommandContext(runCtx, uvBinary, args...)
	command.Dir = directory
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + directory, "TMPDIR=" + directory, "UV_NO_PROGRESS=1"}
	if g.CacheDir != "" {
		command.Env = append(command.Env, "UV_CACHE_DIR="+g.CacheDir)
	}
	if g.PythonDir != "" {
		command.Env = append(command.Env, "UV_PYTHON_INSTALL_DIR="+g.PythonDir)
	}
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr
	if err := command.Run(); err != nil {
		return preview, fmt.Errorf("STEP preview generation failed: %s", truncateOutput(stderr.Bytes(), 1200))
	}
	if err := json.Unmarshal(stdout.Bytes(), &preview); err != nil {
		return preview, fmt.Errorf("STEP preview returned invalid data: %w", err)
	}
	return preview, nil
}

func (g *CadQueryGenerator) ThumbnailSTEP(ctx context.Context, inputPath, outputPath string) error {
	absoluteOutputPath, err := filepath.Abs(outputPath)
	if err != nil {
		return fmt.Errorf("resolve STEP thumbnail output: %w", err)
	}
	directory, err := os.MkdirTemp("", "vibesim-step-thumbnail-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(directory)
	scriptPath := filepath.Join(directory, "thumbnail_step.py")
	if err := os.WriteFile(scriptPath, stepThumbnailScript, 0o500); err != nil {
		return err
	}
	stagedPath := filepath.Join(directory, "input.step")
	if err := copySTEPInput(inputPath, stagedPath); err != nil {
		return fmt.Errorf("stage STEP thumbnail input: %w", err)
	}
	uvBinary, err := resolveCADRuntimeBinary(g.UVBinary)
	if err != nil {
		return err
	}
	args := []string{"run", "--no-project"}
	if g.Offline {
		args = append(args, "--offline")
	}
	args = append(args, "--python", firstConfigured(g.Python, "3.11"), "--with", "cadquery==2.6.1", "python", scriptPath, stagedPath, filepath.Clean(absoluteOutputPath))
	runCtx, cancel := context.WithTimeout(ctx, g.Timeout)
	defer cancel()
	command := exec.CommandContext(runCtx, uvBinary, args...)
	command.Dir = directory
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + directory, "TMPDIR=" + directory, "UV_NO_PROGRESS=1"}
	if g.CacheDir != "" {
		command.Env = append(command.Env, "UV_CACHE_DIR="+g.CacheDir)
	}
	if g.PythonDir != "" {
		command.Env = append(command.Env, "UV_PYTHON_INSTALL_DIR="+g.PythonDir)
	}
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("STEP thumbnail generation failed: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func copySTEPInput(sourcePath, destinationPath string) error {
	source, err := os.Open(filepath.Clean(sourcePath))
	if err != nil {
		return err
	}
	defer source.Close()
	destination, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(destination, source)
	closeErr := destination.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func resolveCADRuntimeBinary(configured string) (string, error) {
	executablePath, _ := os.Executable()
	userHome, _ := os.UserHomeDir()
	candidates := cadRuntimeCandidates(configured, executablePath, userHome)
	for _, candidate := range candidates {
		resolved, err := exec.LookPath(candidate)
		if err != nil {
			continue
		}
		absolute, absoluteErr := filepath.Abs(resolved)
		if absoluteErr == nil {
			return absolute, nil
		}
		return resolved, nil
	}
	if strings.TrimSpace(configured) != "" {
		return "", fmt.Errorf("configured CAD runtime %q was not found or is not executable; set VIBESIM_UV_BINARY to an absolute uv executable", configured)
	}
	return "", errors.New("CAD runtime uv was not found in the application directory, user-local tools, standard package-manager locations, or service PATH; install uv or set VIBESIM_UV_BINARY to an absolute executable")
}

func cadRuntimeCandidates(configured, executablePath, userHome string) []string {
	if configured = strings.TrimSpace(configured); configured != "" {
		return []string{configured}
	}
	candidates := make([]string, 0, 5)
	if executablePath != "" {
		candidates = append(candidates, filepath.Join(filepath.Dir(executablePath), "uv"))
	}
	if userHome != "" {
		candidates = append(candidates, filepath.Join(userHome, ".local", "bin", "uv"))
	}
	candidates = append(candidates, "/opt/homebrew/bin/uv", "/usr/local/bin/uv", "uv")
	result := make([]string, 0, len(candidates))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		candidate = filepath.Clean(candidate)
		if candidate == "." || seen[candidate] {
			continue
		}
		seen[candidate] = true
		result = append(result, candidate)
	}
	return result
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
	case strings.Contains(message, "no interpreter found"), strings.Contains(message, "does not satisfy python"), strings.Contains(message, "requirements are unsatisfiable"):
		return GenerationRuntimeFailure
	default:
		return GenerationGeometryFailure
	}
}

func parseCADDiagnostic(stderr string) *CADDiagnostic {
	const marker = "CAD_DIAGNOSTIC "
	index := strings.LastIndex(stderr, marker)
	if index < 0 {
		return nil
	}
	payload := stderr[index+len(marker):]
	if newline := strings.IndexByte(payload, '\n'); newline >= 0 {
		payload = payload[:newline]
	}
	payload = strings.TrimSpace(payload)
	var diagnostic CADDiagnostic
	if payload == "" || json.Unmarshal([]byte(payload), &diagnostic) != nil || diagnostic.Code == "" {
		return nil
	}
	return &diagnostic
}

func firstConfigured(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
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
