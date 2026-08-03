package aicreate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const BlueprintVersion = "v1"

type Completer interface {
	Complete(context.Context, string, string, string) (string, error)
}

type Blueprint struct {
	Version          string         `json:"version"`
	Decision         string         `json:"decision"`
	ProjectName      string         `json:"project_name"`
	Summary          string         `json:"summary"`
	Geometry         Geometry       `json:"geometry"`
	SimulationParams map[string]any `json:"simulation_params"`
	Assumptions      []string       `json:"assumptions"`
	Questions        []string       `json:"questions,omitempty"`
	Target           string         `json:"target"`
}

type Geometry struct {
	Name           string      `json:"name"`
	Unit           string      `json:"unit"`
	Representation string      `json:"representation"`
	Format         string      `json:"format"`
	Generator      string      `json:"generator"`
	Operations     []Operation `json:"operations"`
	Result         string      `json:"result"`
	Validated      bool        `json:"validated"`
	Validation     string      `json:"validation,omitempty"`
}

type Operation struct {
	ID     string         `json:"id"`
	Op     string         `json:"op"`
	Params map[string]any `json:"params"`
}

type simulationSpec struct {
	VelocityMS          float64 `json:"velocity_m_s"`
	AlphaDeg            float64 `json:"alpha_deg"`
	SurfaceEdgeLengthM  float64 `json:"surface_edge_length_m"`
	FirstLayerThickness float64 `json:"first_layer_thickness_m"`
	MaxSteps            int     `json:"max_steps"`
}

type designResponse struct {
	Version     string         `json:"version"`
	Decision    string         `json:"decision"`
	ProjectName string         `json:"project_name"`
	Summary     string         `json:"summary"`
	Geometry    Geometry       `json:"geometry"`
	Simulation  simulationSpec `json:"simulation"`
	Assumptions []string       `json:"assumptions"`
	Questions   []string       `json:"questions"`
}

type MissingInputError struct {
	Questions []string
}

func (e *MissingInputError) Error() string {
	if len(e.Questions) == 0 {
		return "the agent needs more geometry information"
	}
	return strings.Join(e.Questions, " ")
}

const geometrySystemPrompt = `You are the geometry-planning agent inside an engineering simulation product.
Interpret the user's actual request. Never substitute a canned example or pre-generated asset.

Return ONLY one JSON object matching AI_CREATE_GEOMETRY_V1.
- version: "v1"
- decision: "generate" or "request-input"
- project_name: concise English name
- summary: concise English engineering summary
- geometry: {name, unit:"m", representation:"analytic-brep", format:"step", generator:"cadquery-dsl-v1", operations, result}
- operations: ordered array of {id, op, params}. IDs must be unique.
- simulation: {velocity_m_s, alpha_deg, surface_edge_length_m, first_layer_thickness_m, max_steps}
- assumptions: English string array
- questions: English string array

The deterministic CAD DSL supports:
- box params: length, width, height
- cylinder params: radius, height, axis ("x", "y", or "z")
- sphere params: radius
- cone params: radius1, radius2, height, axis
- extrude params: profile ([[x,y], ...]), distance, axis
- revolve params: profile ([[radius, axial], ...]), angle, axis
- translate params: source, vector ([x,y,z])
- rotate params: source, axis_start, axis_end, angle
- union/cut/intersect params: left, right
- fillet params: source, radius

All dimensions are finite metres and all angles are degrees. Use multiple operations and booleans when the requested geometry requires them. The final result must be one closed solid suitable for exact STEP export. Do not emit Python, file paths, shell commands, STL, meshes, external URLs, or unsupported operations.

Use decision "request-input" when the requested shape cannot be represented faithfully by this DSL or when missing dimensions would materially change the geometry. In that case provide focused questions and leave geometry.operations empty. Reasonable CFD operating and meshing values may be explicit assumptions; do not invent defining geometry features.`

func Design(ctx context.Context, model Completer, intent string) (Blueprint, error) {
	intent = strings.TrimSpace(intent)
	if intent == "" {
		return Blueprint{}, errors.New("simulation requirement is required")
	}
	if model == nil {
		return Blueprint{}, errors.New("AI Create geometry agent is unavailable")
	}
	raw, err := model.Complete(ctx, geometrySystemPrompt, "User simulation request:\n"+intent, "")
	if err != nil {
		return Blueprint{}, fmt.Errorf("geometry agent failed: %w", err)
	}
	var response designResponse
	if err := json.Unmarshal(extractJSONObject(raw), &response); err != nil {
		return Blueprint{}, fmt.Errorf("geometry agent returned invalid JSON: %w", err)
	}
	if response.Version != BlueprintVersion {
		return Blueprint{}, fmt.Errorf("geometry agent returned unsupported contract %q", response.Version)
	}
	if response.Decision == "request-input" {
		if len(response.Questions) == 0 {
			response.Questions = []string{"Please provide the defining geometry dimensions or attach an exact CAD model."}
		}
		return Blueprint{}, &MissingInputError{Questions: response.Questions}
	}
	if response.Decision != "generate" {
		return Blueprint{}, fmt.Errorf("geometry agent returned invalid decision %q", response.Decision)
	}
	if err := validateGeometry(response.Geometry); err != nil {
		return Blueprint{}, fmt.Errorf("geometry agent produced an unsafe or incomplete CAD plan: %w", err)
	}
	if strings.TrimSpace(response.ProjectName) == "" || strings.TrimSpace(response.Summary) == "" {
		return Blueprint{}, errors.New("geometry agent omitted the project name or summary")
	}
	if err := validateSimulation(response.Simulation); err != nil {
		return Blueprint{}, fmt.Errorf("geometry agent produced incomplete simulation parameters: %w", err)
	}
	response.Geometry.Validated = false
	response.Geometry.Validation = "Pending deterministic CAD generation and topology validation."
	return Blueprint{
		Version: BlueprintVersion, Decision: response.Decision,
		ProjectName: response.ProjectName, Summary: response.Summary,
		Geometry: response.Geometry, Assumptions: response.Assumptions,
		Target: "case",
		SimulationParams: map[string]any{
			"meshing": map[string]any{"defaults": map[string]any{
				"surface_max_edge_length":              map[string]any{"value": response.Simulation.SurfaceEdgeLengthM, "units": "m"},
				"boundary_layer_first_layer_thickness": map[string]any{"value": response.Simulation.FirstLayerThickness, "units": "m"},
			}},
			"operating_condition": map[string]any{
				"velocity_magnitude": map[string]any{"value": response.Simulation.VelocityMS, "units": "m/s"},
				"alpha":              map[string]any{"value": response.Simulation.AlphaDeg, "units": "degree"},
			},
			"time_stepping": map[string]any{"max_steps": response.Simulation.MaxSteps},
		},
	}, nil
}

var identifierPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)

func validateGeometry(geometry Geometry) error {
	if !identifierPattern.MatchString(geometry.Name) {
		return errors.New("geometry name must be a safe non-empty identifier")
	}
	if geometry.Unit != "m" || geometry.Format != "step" || geometry.Representation != "analytic-brep" || geometry.Generator != "cadquery-dsl-v1" {
		return errors.New("geometry metadata must select metre-based analytic STEP through cadquery-dsl-v1")
	}
	if len(geometry.Operations) == 0 || len(geometry.Operations) > 64 {
		return errors.New("geometry must contain between 1 and 64 operations")
	}
	seen := map[string]bool{}
	for _, operation := range geometry.Operations {
		if !identifierPattern.MatchString(operation.ID) || seen[operation.ID] {
			return fmt.Errorf("invalid or duplicate operation ID %q", operation.ID)
		}
		seen[operation.ID] = true
		if err := validateOperation(operation, seen); err != nil {
			return fmt.Errorf("operation %s: %w", operation.ID, err)
		}
	}
	if !seen[geometry.Result] {
		return errors.New("geometry result does not reference an operation")
	}
	return nil
}

func validateOperation(operation Operation, available map[string]bool) error {
	allowed := map[string][]string{
		"box": {"length", "width", "height"}, "cylinder": {"radius", "height"},
		"sphere": {"radius"}, "cone": {"radius1", "radius2", "height"},
		"extrude": {"distance"}, "revolve": {"angle"}, "fillet": {"radius"},
	}
	referenceKeys := map[string][]string{
		"translate": {"source"}, "rotate": {"source"}, "fillet": {"source"},
		"union": {"left", "right"}, "cut": {"left", "right"}, "intersect": {"left", "right"},
	}
	if keys, ok := allowed[operation.Op]; ok {
		for _, key := range keys {
			value, ok := number(operation.Params[key])
			if !ok || value <= 0 || value > 1e6 {
				return fmt.Errorf("%s must be a positive finite number", key)
			}
		}
	} else if _, ok := referenceKeys[operation.Op]; !ok && operation.Op != "translate" && operation.Op != "rotate" {
		return fmt.Errorf("unsupported operation %q", operation.Op)
	}
	for _, key := range referenceKeys[operation.Op] {
		reference, _ := operation.Params[key].(string)
		if !available[reference] || reference == operation.ID {
			return fmt.Errorf("%s must reference an earlier operation", key)
		}
	}
	if (operation.Op == "extrude" || operation.Op == "revolve") && !validProfile(operation.Params["profile"]) {
		return errors.New("profile must contain 3 to 128 finite two-dimensional points")
	}
	if operation.Op == "translate" && !validVector(operation.Params["vector"]) {
		return errors.New("vector must contain three finite numbers")
	}
	if operation.Op == "rotate" && (!validVector(operation.Params["axis_start"]) || !validVector(operation.Params["axis_end"])) {
		return errors.New("rotation axis endpoints must contain three finite numbers")
	}
	if axis, present := operation.Params["axis"]; present {
		axisName, ok := axis.(string)
		if !ok || (axisName != "x" && axisName != "y" && axisName != "z") {
			return errors.New("axis must be x, y, or z")
		}
	}
	if operation.Op == "revolve" {
		axisName, _ := operation.Params["axis"].(string)
		if axisName != "" && axisName != "z" {
			return errors.New("revolve currently supports axis z")
		}
	}
	if operation.Op == "rotate" {
		angle, ok := number(operation.Params["angle"])
		if !ok || angle < -360 || angle > 360 {
			return errors.New("rotation angle must be finite and between -360 and 360 degrees")
		}
		if vectorsEqual(operation.Params["axis_start"], operation.Params["axis_end"]) {
			return errors.New("rotation axis endpoints must be different")
		}
	}
	return nil
}

func validateSimulation(spec simulationSpec) error {
	if spec.VelocityMS <= 0 || spec.VelocityMS > 1e5 || spec.SurfaceEdgeLengthM <= 0 || spec.FirstLayerThickness <= 0 || spec.MaxSteps < 1 || spec.MaxSteps > 10_000_000 {
		return errors.New("velocity, mesh sizes, and max steps must be positive and bounded")
	}
	if spec.AlphaDeg < -180 || spec.AlphaDeg > 180 {
		return errors.New("angle of attack must be between -180 and 180 degrees")
	}
	return nil
}

func number(value any) (float64, bool) {
	n, ok := value.(float64)
	return n, ok && n == n && n > -1e308 && n < 1e308
}

func validVector(value any) bool {
	items, ok := value.([]any)
	if !ok || len(items) != 3 {
		return false
	}
	for _, item := range items {
		if _, ok := number(item); !ok {
			return false
		}
	}
	return true
}

func validProfile(value any) bool {
	items, ok := value.([]any)
	if !ok || len(items) < 3 || len(items) > 128 {
		return false
	}
	for _, item := range items {
		point, ok := item.([]any)
		if !ok || len(point) != 2 {
			return false
		}
		if _, ok := number(point[0]); !ok {
			return false
		}
		if _, ok := number(point[1]); !ok {
			return false
		}
	}
	return true
}

func vectorsEqual(left, right any) bool {
	a, aOK := left.([]any)
	b, bOK := right.([]any)
	if !aOK || !bOK || len(a) != 3 || len(b) != 3 {
		return false
	}
	for index := range a {
		aValue, aNumber := number(a[index])
		bValue, bNumber := number(b[index])
		if !aNumber || !bNumber || aValue != bValue {
			return false
		}
	}
	return true
}

func extractJSONObject(raw string) []byte {
	raw = strings.TrimSpace(raw)
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end < start {
		return []byte(raw)
	}
	return []byte(raw[start : end+1])
}
