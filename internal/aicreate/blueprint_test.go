package aicreate

import (
	"bytes"
	"strings"
	"testing"
)

func TestFromIntentBuildsCylinderBlueprint(t *testing.T) {
	blueprint, err := FromIntent("帮我实现一个圆柱扰流仿真试验")
	if err != nil {
		t.Fatal(err)
	}
	if blueprint.Template != "cylinder-flow-v3" || blueprint.Geometry.DiameterM != 1 || blueprint.Target != "case" {
		t.Fatalf("unexpected blueprint: %#v", blueprint)
	}
	if blueprint.Geometry.Representation != "analytic-brep" || blueprint.Geometry.Format != "brep" || !blueprint.Geometry.Validated {
		t.Fatalf("expected validated CAD provenance: %#v", blueprint.Geometry)
	}
	if len(blueprint.SimulationParams) == 0 || len(blueprint.Assumptions) == 0 {
		t.Fatal("expected preloaded parameters and explicit assumptions")
	}
	defaults := blueprint.SimulationParams["meshing"].(map[string]any)["defaults"].(map[string]any)
	if defaults["boundary_layer_first_layer_thickness"] == nil {
		t.Fatal("expected a complete Volume Mesh boundary-layer default")
	}
}

func TestFromIntentRefusesToFakeUnsupportedCylinderDimensions(t *testing.T) {
	for _, intent := range []string{
		"simulate a cylinder with diameter 2.5 m",
		"simulate a cylinder with radius 0.75 m",
		"simulate a cylinder with span 3 m",
	} {
		if _, err := FromIntent(intent); err == nil {
			t.Fatalf("expected exact CAD template dimension error for %q", intent)
		}
	}
}

func TestFromIntentRejectsUnsupportedGeometry(t *testing.T) {
	if _, err := FromIntent("simulate an aircraft wing"); err == nil {
		t.Fatal("expected unsupported geometry error")
	}
}

func TestWriteCylinderBREPContainsAnalyticSurfacesWithoutTessellation(t *testing.T) {
	blueprint, _ := FromIntent("cylinder flow")
	var output bytes.Buffer
	if err := WriteCylinderBREP(&output, blueprint.Geometry); err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{"CASCADE Topology V3", "Surfaces 3", "Triangulations 0", "So"} {
		if !strings.Contains(output.String(), marker) {
			t.Fatalf("missing B-rep marker %q", marker)
		}
	}
	if strings.Contains(output.String(), "facet normal") {
		t.Fatal("exact CAD asset unexpectedly contains STL facets")
	}
}
