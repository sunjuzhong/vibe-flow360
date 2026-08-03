package aicreate

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

var numberPattern = regexp.MustCompile(`(?i)(?:diameter|直径)\s*(?:为|=|:)?\s*([0-9]+(?:\.[0-9]+)?)`)
var radiusPattern = regexp.MustCompile(`(?i)(?:radius|半径)\s*(?:为|=|:)?\s*([0-9]+(?:\.[0-9]+)?)`)
var spanPattern = regexp.MustCompile(`(?i)(?:span|length|高度|长度|展向)\s*(?:为|=|:)?\s*([0-9]+(?:\.[0-9]+)?)`)

type Blueprint struct {
	Template         string         `json:"template"`
	ProjectName      string         `json:"project_name"`
	Summary          string         `json:"summary"`
	Geometry         Geometry       `json:"geometry"`
	SimulationParams map[string]any `json:"simulation_params"`
	Assumptions      []string       `json:"assumptions"`
	Target           string         `json:"target"`
}

type Geometry struct {
	Kind             string  `json:"kind"`
	DiameterM        float64 `json:"diameter_m"`
	SpanM            float64 `json:"span_m"`
	Representation   string  `json:"representation"`
	Format           string  `json:"format"`
	Generator        string  `json:"generator"`
	GeneratorVersion string  `json:"generator_version"`
	Validated        bool    `json:"validated"`
	Validation       string  `json:"validation"`
}

func FromIntent(intent string) (Blueprint, error) {
	trimmed := strings.TrimSpace(intent)
	if trimmed == "" {
		return Blueprint{}, errors.New("simulation requirement is required")
	}
	lower := strings.ToLower(trimmed)
	if !strings.Contains(lower, "cylinder") && !strings.Contains(trimmed, "圆柱") {
		return Blueprint{}, errors.New("this first AI Create template supports cylinder flow; attach CAD for other geometries")
	}

	diameter := 1.0
	if match := numberPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		if parsed, err := strconv.ParseFloat(match[1], 64); err == nil && parsed > 0 {
			diameter = parsed
		}
	}
	if match := radiusPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		if parsed, err := strconv.ParseFloat(match[1], 64); err == nil && parsed > 0 {
			diameter = 2 * parsed
		}
	}
	span := 1.0
	if match := spanPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		if parsed, err := strconv.ParseFloat(match[1], 64); err == nil && parsed > 0 {
			span = parsed
		}
	}
	if diameter != 1 || span != 1 {
		return Blueprint{}, errors.New("the built-in exact CAD cylinder is 1 m in diameter and span; upload a STEP, IGES, or BREP file for other dimensions")
	}
	maxEdge := diameter / 30
	firstLayerThickness := 2.5e-5
	return Blueprint{
		Template:    "cylinder-flow-v3",
		ProjectName: "AI Create · Cylinder Flow (Exact CAD)",
		Summary:     "Low-speed external flow around an analytic B-rep circular cylinder, prepared through Case setup.",
		Geometry: Geometry{
			Kind: "cylinder", DiameterM: diameter, SpanM: span,
			Representation: "analytic-brep", Format: "brep",
			Generator: "CadQuery/OpenCascade", GeneratorVersion: "CadQuery 2.6.1 / OpenCascade 7.8.1",
			Validated: true, Validation: "Closed solid; 3 analytic faces; volume pi/4 m^3; no tessellation records.",
		},
		SimulationParams: map[string]any{
			"meshing": map[string]any{"defaults": map[string]any{
				"surface_max_edge_length":              map[string]any{"value": maxEdge, "units": "m"},
				"boundary_layer_first_layer_thickness": map[string]any{"value": firstLayerThickness, "units": "m"},
			}},
			"operating_condition": map[string]any{
				"velocity_magnitude": map[string]any{"value": 10.0, "units": "m/s"},
				"alpha":              map[string]any{"value": 0.0, "units": "degree"},
			},
			"time_stepping": map[string]any{"max_steps": 10000},
		},
		Assumptions: []string{
			"The built-in exact CAD template is a 1 m diameter × 1 m span analytic B-rep cylinder.",
			"Freestream velocity is 10 m/s at zero angle of attack.",
			"A medium surface resolution of diameter / 30 is used.",
			"A 25 micrometre first boundary-layer cell is used as a reviewable wall-resolved starting point.",
			"The generated CAD faces are assigned explicitly to the Wall boundary condition.",
			"Flow360's Geometry baseline supplies the schema version, SI unit system, automated farfield, air model, solver defaults, and surface outputs.",
			"Remote meshing and Case execution still require the normal review and approval gate.",
		},
		Target: "case",
	}, nil
}
