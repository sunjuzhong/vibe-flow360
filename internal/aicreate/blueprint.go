package aicreate

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

var numberPattern = regexp.MustCompile(`(?i)(?:diameter|直径)\s*(?:为|=|:)?\s*([0-9]+(?:\.[0-9]+)?)`)

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
	Kind      string  `json:"kind"`
	DiameterM float64 `json:"diameter_m"`
	SpanM     float64 `json:"span_m"`
	Segments  int     `json:"segments"`
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
	maxEdge := diameter / 30
	return Blueprint{
		Template:    "cylinder-flow-v1",
		ProjectName: "AI Create · Cylinder Flow",
		Summary:     "External incompressible flow around a circular cylinder, prepared through Case setup.",
		Geometry:    Geometry{Kind: "cylinder", DiameterM: diameter, SpanM: diameter, Segments: 64},
		SimulationParams: map[string]any{
			"meshing": map[string]any{"defaults": map[string]any{
				"surface_max_edge_length": map[string]any{"value": maxEdge, "units": "m"},
			}},
			"operating_condition": map[string]any{
				"velocity_magnitude": map[string]any{"value": 10.0, "units": "m/s"},
				"alpha":              map[string]any{"value": 0.0, "units": "degree"},
			},
			"time_stepping": map[string]any{"max_steps": 10000},
		},
		Assumptions: []string{
			"Cylinder dimensions are interpreted in metres.",
			"Freestream velocity is 10 m/s at zero angle of attack.",
			"A medium surface resolution of diameter / 30 is used.",
			"Remote meshing and Case execution still require the normal review and approval gate.",
		},
		Target: "case",
	}, nil
}
