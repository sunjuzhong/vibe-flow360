package flow360

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPreflightLevels(t *testing.T) {
	tests := []struct {
		root   string
		target string
		levels []string
	}{
		{"Geometry", "surface-mesh", []string{"SurfaceMesh"}},
		{"Geometry", "case", []string{"SurfaceMesh", "VolumeMesh", "Case"}},
		{"SurfaceMesh", "case", []string{"VolumeMesh", "Case"}},
		{"VolumeMesh", "case", []string{"Case"}},
		{"Case", "case", []string{"Case"}},
	}
	for _, test := range tests {
		_, got, err := preflightLevels(test.root, test.target)
		if err != nil {
			t.Fatalf("%s to %s: %v", test.root, test.target, err)
		}
		if !reflect.DeepEqual(got, test.levels) {
			t.Fatalf("%s to %s: got %v, want %v", test.root, test.target, got, test.levels)
		}
	}
	if _, _, err := preflightLevels("VolumeMesh", "surface-mesh"); err == nil {
		t.Fatal("expected backwards target to be rejected")
	}
}

func TestPreflightSimulationParamsUsesStructuredBridgeResult(t *testing.T) {
	temp := t.TempDir()
	fake := filepath.Join(temp, "python")
	script := `#!/bin/sh
printf '%s' '{"schema_version":1,"validator_version":"test","valid":false,"issues":[{"level":"error","code":"missing","path":"operating_condition.velocity_magnitude","message":"Field required","stages":["Case"]}],"form_schema":{"type":"object","properties":{"operating_condition":{"type":"object"}}}}'
`
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_FLOW360_PYTHON", fake)
	client := &Client{Binary: "flow360"}
	result, err := client.PreflightSimulationParams(
		context.Background(),
		"Geometry",
		"case",
		json.RawMessage(`{"version":"25.10.16","unit_system":{"name":"SI"}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Valid || len(result.Issues) != 1 {
		t.Fatalf("unexpected result %#v", result)
	}
	if result.Issues[0].Path != "operating_condition.velocity_magnitude" {
		t.Fatalf("unexpected issue %#v", result.Issues[0])
	}
}

func TestPreflightSimulationParamsWithInstalledSchema(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	client := NewClient()
	result, err := client.PreflightSimulationParams(
		context.Background(),
		"Geometry",
		"case",
		json.RawMessage(`{"unit_system":{"name":"SI"}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Valid || len(result.Issues) == 0 {
		t.Fatalf("expected missing CFD inputs, got %#v", result)
	}
}
