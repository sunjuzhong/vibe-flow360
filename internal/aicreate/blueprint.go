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
	Name           string           `json:"name"`
	Unit           string           `json:"unit"`
	Representation string           `json:"representation"`
	Format         string           `json:"format"`
	Generator      string           `json:"generator"`
	Operations     []Operation      `json:"operations"`
	Result         string           `json:"result,omitempty"`
	Results        []GeometryResult `json:"results,omitempty"`
	Validated      bool             `json:"validated"`
	Validation     string           `json:"validation,omitempty"`
}

type GeometryResult struct {
	Source string      `json:"source"`
	Name   string      `json:"name"`
	Faces  []FaceLabel `json:"faces,omitempty"`
}

type FaceLabel struct {
	Name     string `json:"name"`
	Selector string `json:"selector"`
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
	Version     string          `json:"version"`
	Decision    string          `json:"decision"`
	ProjectName string          `json:"project_name"`
	Summary     string          `json:"summary"`
	Geometry    Geometry        `json:"geometry"`
	Simulation  simulationSpec  `json:"simulation"`
	Assumptions []string        `json:"assumptions"`
	Questions   json.RawMessage `json:"questions"`
}

type MissingInputError struct {
	Questions []string
	Fields    []ClarificationField
}

func (e *MissingInputError) Error() string {
	if len(e.Questions) == 0 {
		return "the agent needs more geometry information"
	}
	return strings.Join(e.Questions, " ")
}

type ClarificationOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type ClarificationField struct {
	ID          string                `json:"id"`
	Label       string                `json:"label"`
	Description string                `json:"description,omitempty"`
	Type        string                `json:"type"`
	Required    bool                  `json:"required"`
	Unit        string                `json:"unit,omitempty"`
	Options     []ClarificationOption `json:"options,omitempty"`
	Default     any                   `json:"default,omitempty"`
	Min         *float64              `json:"min,omitempty"`
	Max         *float64              `json:"max,omitempty"`
}

type ClarificationRound struct {
	Fields  []ClarificationField `json:"fields"`
	Answers map[string]any       `json:"answers"`
}

const geometrySystemPrompt = `You are the geometry-planning agent inside an engineering simulation product.
Interpret the user's actual request. Never substitute a canned example or pre-generated asset.

Return ONLY one JSON object matching AI_CREATE_GEOMETRY_V1.
- version: "v1"
- decision: "generate" or "request-input"
- project_name: concise English name
- summary: concise English engineering summary
- geometry: {name, unit:"m", representation:"analytic-brep", format:"step", generator:"cadquery-dsl-v1", operations, results}
- operations: ordered array of {id, op, params}. IDs must be unique.
- results: one or more {source, name, faces}. source references an operation, name is a stable STEP body name, and faces is an optional array of {name, selector}.
- simulation: {velocity_m_s, alpha_deg, surface_edge_length_m, first_layer_thickness_m, max_steps}
- assumptions: English string array
- questions: for request-input, an array of dynamic fields: {id, label, description, type, required, unit, options, default, min, max}. type is "text", "number", "select", or "boolean". options is required only for select and contains {value,label}.

The deterministic CAD DSL supports:
- box params: length, width, height
- cylinder params: radius, height, axis ("x", "y", or "z")
- sphere params: radius
- cone params: radius1, radius2, height, axis
- extrude params: profile ([[x,y], ...]), profile_type (optional "polyline" or "spline"), distance, axis
- revolve params: profile ([[radius, axial], ...]), profile_type (optional "polyline" or "spline"), angle, axis
- loft params: sections ([{offset, profile:[[x,y], ...], profile_type:optional}], ...]), axis
- sweep params: profile ([[x,y], ...]), profile_type (optional "polyline" or "spline"), path ([[x,y,z], ...]), profile_plane ("XY", "XZ", or "YZ")
- translate params: source, vector ([x,y,z])
- rotate params: source, axis_start, axis_end, angle
- union/cut/intersect params: left, right
- fillet params: source, radius

Supported deterministic face selectors are >X, <X, >Y, <Y, >Z, <Z, |X, |Y, |Z, %PLANE, %CYLINDER, %CONE, %SPHERE, and %TORUS. Give every result a descriptive body name and label engineering-relevant faces such as inlet, outlet, wall, symmetry, blade, or farfield. A selector may match multiple faces; they are exported with deterministic numeric suffixes.

All dimensions are finite metres and all angles are degrees. Use multiple operations, bodies, and booleans when the requested geometry requires them. Every result must contain one or more closed solids suitable for exact STEP export. Do not emit Python, file paths, shell commands, STL, meshes, external URLs, or unsupported operations.

Use decision "request-input" when the requested shape cannot be represented faithfully by this DSL or when missing dimensions would materially change the geometry or physics. In that case provide at most six focused dynamic fields and leave geometry.operations empty. Use number fields with explicit engineering units and realistic bounds, select fields for mutually exclusive engineering choices, boolean fields for yes/no decisions, and text only when structured input is impossible. Match labels and descriptions to the user's language. Ask only for currently blocking facts and never repeat a field already answered in the clarification history. Reasonable CFD operating and meshing values may be explicit assumptions; do not invent defining geometry features.`

func Design(ctx context.Context, model Completer, intent string) (Blueprint, error) {
	return DesignConversation(ctx, model, intent, nil)
}

func DesignConversation(ctx context.Context, model Completer, intent string, history []ClarificationRound) (Blueprint, error) {
	intent = strings.TrimSpace(intent)
	if intent == "" {
		return Blueprint{}, errors.New("simulation requirement is required")
	}
	if model == nil {
		return Blueprint{}, errors.New("AI Create geometry agent is unavailable")
	}
	userPrompt := "User simulation request:\n" + intent
	if len(history) > 0 {
		encoded, marshalErr := json.Marshal(history)
		if marshalErr != nil {
			return Blueprint{}, fmt.Errorf("encode clarification history: %w", marshalErr)
		}
		userPrompt += "\n\nClarification history (authoritative user answers; do not ask these again):\n" + string(encoded)
	}
	raw, err := model.Complete(ctx, geometrySystemPrompt, userPrompt, "")
	if err != nil {
		return Blueprint{}, fmt.Errorf("geometry agent failed: %w", err)
	}
	return designFromAgentResponse(ctx, model, userPrompt, raw, true)
}

func RepairAfterGenerationFailure(ctx context.Context, model Completer, intent string, history []ClarificationRound, current Blueprint, diagnostic string) (Blueprint, error) {
	if model == nil {
		return Blueprint{}, errors.New("AI Create geometry agent is unavailable")
	}
	currentJSON, err := json.Marshal(current)
	if err != nil {
		return Blueprint{}, fmt.Errorf("encode failed CAD plan: %w", err)
	}
	historyJSON, err := json.Marshal(history)
	if err != nil {
		return Blueprint{}, fmt.Errorf("encode clarification history: %w", err)
	}
	if len(diagnostic) > 2000 {
		diagnostic = diagnostic[:2000]
	}
	userPrompt := "User simulation request:\n" + strings.TrimSpace(intent) +
		"\n\nClarification history (authoritative user answers):\n" + string(historyJSON) +
		"\n\nThe deterministic CadQuery/OpenCascade execution of the previous plan failed. Diagnose the CAD construction, then return a corrected complete AI_CREATE_GEOMETRY_V1 JSON object. Preserve the user's intent and confirmed answers. If a defining engineering choice is truly missing, return request-input fields instead. Do not explain the correction outside JSON." +
		"\nExecution diagnostic:\n" + diagnostic + "\nPrevious blueprint:\n" + string(currentJSON)
	repaired, err := model.Complete(ctx, geometrySystemPrompt, userPrompt, "")
	if err != nil {
		return Blueprint{}, fmt.Errorf("geometry self-repair failed: %w", err)
	}
	return designFromAgentResponse(ctx, model, userPrompt, repaired, false)
}

func designFromAgentResponse(ctx context.Context, model Completer, userPrompt, raw string, allowRepair bool) (Blueprint, error) {
	var response designResponse
	if err := json.Unmarshal(extractJSONObject(raw), &response); err != nil {
		return Blueprint{}, fmt.Errorf("geometry agent returned invalid JSON: %w", err)
	}
	if response.Version != BlueprintVersion {
		return Blueprint{}, fmt.Errorf("geometry agent returned unsupported contract %q", response.Version)
	}
	if response.Decision == "request-input" {
		fields, fieldErr := parseClarificationFields(response.Questions)
		if fieldErr != nil {
			return Blueprint{}, fmt.Errorf("geometry agent returned invalid clarification fields: %w", fieldErr)
		}
		questions := make([]string, 0, len(fields))
		for _, field := range fields {
			questions = append(questions, field.Label)
		}
		return Blueprint{}, &MissingInputError{Questions: questions, Fields: fields}
	}
	if response.Decision != "generate" {
		return Blueprint{}, fmt.Errorf("geometry agent returned invalid decision %q", response.Decision)
	}
	normalizeGeometryIdentifiers(&response.Geometry, response.ProjectName)
	if err := validateGeometry(response.Geometry); err != nil {
		if allowRepair {
			repairPrompt := userPrompt + "\n\nThe previous CAD plan failed deterministic validation: " + err.Error() +
				"\nReturn a corrected complete AI_CREATE_GEOMETRY_V1 JSON object. Preserve the user's intent and answers. Do not explain the correction.\nPrevious response:\n" + raw
			repaired, repairErr := model.Complete(ctx, geometrySystemPrompt, repairPrompt, "")
			if repairErr != nil {
				return Blueprint{}, fmt.Errorf("geometry agent repair failed: %w", repairErr)
			}
			return designFromAgentResponse(ctx, model, userPrompt, repaired, false)
		}
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

var unsafeIdentifierCharacters = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

func normalizeGeometryIdentifiers(geometry *Geometry, projectName string) {
	geometry.Name = normalizedIdentifier(geometry.Name, normalizedIdentifier(projectName, "agent-geometry", nil), nil)
	operationNames := map[string]string{}
	usedOperations := map[string]bool{}
	for index := range geometry.Operations {
		operation := &geometry.Operations[index]
		originalID := operation.ID
		for _, key := range []string{"source", "left", "right"} {
			if reference, ok := operation.Params[key].(string); ok {
				if normalized, exists := operationNames[reference]; exists {
					operation.Params[key] = normalized
				}
			}
		}
		operation.ID = normalizedIdentifier(originalID, fmt.Sprintf("operation-%d", index+1), usedOperations)
		if _, duplicate := operationNames[originalID]; !duplicate {
			operationNames[originalID] = operation.ID
		}
		operation.Op = strings.ToLower(strings.TrimSpace(operation.Op))
	}
	if normalized, exists := operationNames[geometry.Result]; exists {
		geometry.Result = normalized
	}
	usedResults := map[string]bool{}
	for resultIndex := range geometry.Results {
		result := &geometry.Results[resultIndex]
		if normalized, exists := operationNames[result.Source]; exists {
			result.Source = normalized
		}
		result.Name = normalizedIdentifier(result.Name, fmt.Sprintf("body-%d", resultIndex+1), usedResults)
		usedFaces := map[string]bool{}
		for faceIndex := range result.Faces {
			face := &result.Faces[faceIndex]
			face.Name = normalizedIdentifier(face.Name, fmt.Sprintf("face-%d", faceIndex+1), usedFaces)
			face.Selector = strings.ToUpper(strings.TrimSpace(face.Selector))
		}
	}
}

func normalizedIdentifier(value, fallback string, used map[string]bool) string {
	value = strings.Trim(unsafeIdentifierCharacters.ReplaceAllString(strings.TrimSpace(value), "-"), "-_")
	if value == "" {
		value = strings.Trim(unsafeIdentifierCharacters.ReplaceAllString(strings.TrimSpace(fallback), "-"), "-_")
	}
	if value == "" {
		value = "item"
	}
	if value[0] < 'A' || value[0] > 'Z' && value[0] < 'a' || value[0] > 'z' {
		value = "item-" + value
	}
	if len(value) > 64 {
		value = strings.TrimRight(value[:64], "-_")
	}
	if used == nil {
		return value
	}
	base := value
	for suffix := 2; used[value]; suffix++ {
		ending := fmt.Sprintf("-%d", suffix)
		limit := 64 - len(ending)
		value = strings.TrimRight(base[:min(len(base), limit)], "-_") + ending
	}
	used[value] = true
	return value
}

func parseClarificationFields(raw json.RawMessage) ([]ClarificationField, error) {
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "[]" {
		return []ClarificationField{{
			ID: "geometry_details", Label: "Please provide the defining geometry dimensions or attach an exact CAD model.",
			Type: "text", Required: true,
		}}, nil
	}
	var fields []ClarificationField
	if err := json.Unmarshal(raw, &fields); err != nil {
		var questions []string
		if stringErr := json.Unmarshal(raw, &questions); stringErr != nil {
			return nil, err
		}
		fields = make([]ClarificationField, 0, len(questions))
		for index, question := range questions {
			fields = append(fields, ClarificationField{
				ID: fmt.Sprintf("clarification_%d", index+1), Label: strings.TrimSpace(question), Type: "text", Required: true,
			})
		}
	}
	if len(fields) == 0 || len(fields) > 6 {
		return nil, errors.New("clarification must contain between 1 and 6 fields")
	}
	seen := map[string]bool{}
	for index := range fields {
		field := &fields[index]
		field.ID = normalizedIdentifier(field.ID, fmt.Sprintf("clarification-%d", index+1), seen)
		field.Label = strings.TrimSpace(field.Label)
		field.Type = strings.ToLower(strings.TrimSpace(field.Type))
		if !identifierPattern.MatchString(field.ID) || field.Label == "" || len(field.Label) > 240 {
			return nil, fmt.Errorf("invalid or duplicate clarification field %q", field.ID)
		}
		switch field.Type {
		case "text", "number", "boolean":
		case "select":
			if len(field.Options) < 2 || len(field.Options) > 16 {
				return nil, fmt.Errorf("select field %s must contain 2 to 16 options", field.ID)
			}
			optionValues := map[string]bool{}
			for optionIndex := range field.Options {
				option := &field.Options[optionIndex]
				option.Value, option.Label = strings.TrimSpace(option.Value), strings.TrimSpace(option.Label)
				if option.Value == "" || option.Label == "" || optionValues[option.Value] {
					return nil, fmt.Errorf("select field %s contains an invalid option", field.ID)
				}
				optionValues[option.Value] = true
			}
		default:
			return nil, fmt.Errorf("unsupported clarification type %q", field.Type)
		}
		if field.Min != nil && field.Max != nil && *field.Min > *field.Max {
			return nil, fmt.Errorf("clarification field %s has invalid bounds", field.ID)
		}
	}
	return fields, nil
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
	if strings.TrimSpace(geometry.Result) != "" && len(geometry.Results) != 0 {
		return errors.New("geometry must use either legacy result or named results, not both")
	}
	if len(geometry.Results) == 0 {
		if !seen[geometry.Result] {
			return errors.New("geometry result does not reference an operation")
		}
		return nil
	}
	resultSources := map[string]bool{}
	resultNames := map[string]bool{}
	for _, result := range geometry.Results {
		if !seen[result.Source] || resultSources[result.Source] {
			return fmt.Errorf("geometry result source %q must reference a distinct operation", result.Source)
		}
		if !identifierPattern.MatchString(result.Name) || resultNames[result.Name] {
			return fmt.Errorf("invalid or duplicate result name %q", result.Name)
		}
		resultSources[result.Source], resultNames[result.Name] = true, true
		faceNames := map[string]bool{}
		for _, face := range result.Faces {
			if !identifierPattern.MatchString(face.Name) || faceNames[face.Name] {
				return fmt.Errorf("invalid or duplicate face label %q in result %s", face.Name, result.Name)
			}
			if !validFaceSelector(face.Selector) {
				return fmt.Errorf("unsupported face selector %q in result %s", face.Selector, result.Name)
			}
			faceNames[face.Name] = true
		}
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
	} else if _, ok := referenceKeys[operation.Op]; !ok && operation.Op != "translate" && operation.Op != "rotate" && operation.Op != "loft" && operation.Op != "sweep" {
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
	if profileType, present := operation.Params["profile_type"]; present && !validProfileType(profileType) {
		return errors.New("profile_type must be polyline or spline")
	}
	if operation.Op == "loft" && !validLoftSections(operation.Params["sections"]) {
		return errors.New("loft sections must contain 2 to 32 ordered {offset, profile} entries")
	}
	if operation.Op == "sweep" {
		if !validProfile(operation.Params["profile"]) || !validPath(operation.Params["path"]) {
			return errors.New("sweep requires a valid profile and 2 to 128 finite three-dimensional path points")
		}
		plane, _ := operation.Params["profile_plane"].(string)
		if plane != "XY" && plane != "XZ" && plane != "YZ" {
			return errors.New("sweep profile_plane must be XY, XZ, or YZ")
		}
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

func validLoftSections(value any) bool {
	sections, ok := value.([]any)
	if !ok || len(sections) < 2 || len(sections) > 32 {
		return false
	}
	lastOffset := -1e308
	for _, item := range sections {
		section, ok := item.(map[string]any)
		offset, numberOK := number(section["offset"])
		if !ok || !numberOK || offset <= lastOffset || !validProfile(section["profile"]) {
			return false
		}
		if profileType, present := section["profile_type"]; present && !validProfileType(profileType) {
			return false
		}
		lastOffset = offset
	}
	return true
}

func validProfileType(value any) bool {
	profileType, ok := value.(string)
	return ok && (profileType == "polyline" || profileType == "spline")
}

func validPath(value any) bool {
	items, ok := value.([]any)
	if !ok || len(items) < 2 || len(items) > 128 {
		return false
	}
	for _, item := range items {
		if !validVector(item) {
			return false
		}
	}
	return true
}

func validFaceSelector(selector string) bool {
	switch selector {
	case ">X", "<X", ">Y", "<Y", ">Z", "<Z", "|X", "|Y", "|Z",
		"%PLANE", "%CYLINDER", "%CONE", "%SPHERE", "%TORUS":
		return true
	default:
		return false
	}
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
