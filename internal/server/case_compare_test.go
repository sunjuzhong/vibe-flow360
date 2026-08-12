package server

import (
	"encoding/json"
	"testing"

	"github.com/sunjuzhong/vibe-flow360/internal/comparison"
)

func TestComparisonArtifactsClassifiesResultEvidence(t *testing.T) {
	raw := json.RawMessage(`{"records":[
		{"name":"Residual history","path":"results/nonlinear_residual_v2.csv","file_type":"csv","size_bytes":1200},
		{"name":"Slices","path":"results/slices.tar.gz","size_bytes":4096},
		{"name":"Forces","path":"results/total_forces_v2.csv","size_bytes":800}
	]}`)
	artifacts := comparisonArtifacts(raw)
	if len(artifacts) != 3 {
		t.Fatalf("got %d artifacts, want 3", len(artifacts))
	}
	byPath := map[string]comparison.ResultArtifact{}
	for _, artifact := range artifacts {
		byPath[artifact.Path] = artifact
	}
	if artifact := byPath["results/nonlinear_residual_v2.csv"]; artifact.Category != "residuals" || !artifact.Previewable {
		t.Fatalf("unexpected residual artifact: %#v", artifact)
	}
	if artifact := byPath["results/slices.tar.gz"]; artifact.Category != "flow-fields" || !artifact.Visualization {
		t.Fatalf("unexpected visualization artifact: %#v", artifact)
	}
	if artifact := byPath["results/total_forces_v2.csv"]; artifact.Category != "forces" || !artifact.Previewable {
		t.Fatalf("unexpected force artifact: %#v", artifact)
	}
}

func TestComparisonPromptEvidenceBoundsParameterDiffs(t *testing.T) {
	diffs := make([]comparison.DiffEntry, 100)
	for index := range diffs {
		diffs[index] = comparison.DiffEntry{Path: "value", Baseline: index, Other: index + 1}
	}
	evidence := comparisonPromptEvidence(comparison.CompareResult{Diffs: diffs})
	bounded, ok := evidence["parameter_differences"].([]comparison.DiffEntry)
	if !ok || len(bounded) != 80 {
		t.Fatalf("AI evidence contains %d diffs, want 80", len(bounded))
	}
}

func TestConfiguredOutputCountIgnoresUnrelatedArrays(t *testing.T) {
	raw := json.RawMessage(`{"models":[{"name":"fluid"},{"name":"wall"}],"nested":{"outputs":[{"type":"surface"},{"type":"slice"},{"type":"volume"}]}}`)
	if got := configuredOutputCount(raw); got != 3 {
		t.Fatalf("got %d configured outputs, want 3", got)
	}
}
