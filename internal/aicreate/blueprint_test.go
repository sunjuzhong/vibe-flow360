package aicreate

import (
	"bytes"
	"strings"
	"testing"
)

func TestFromIntentBuildsCylinderBlueprint(t *testing.T) {
	blueprint, err := FromIntent("帮我实现一个直径 2.5 米的圆柱扰流仿真试验")
	if err != nil {
		t.Fatal(err)
	}
	if blueprint.Template != "cylinder-flow-v1" || blueprint.Geometry.DiameterM != 2.5 || blueprint.Target != "case" {
		t.Fatalf("unexpected blueprint: %#v", blueprint)
	}
	if len(blueprint.SimulationParams) == 0 || len(blueprint.Assumptions) == 0 {
		t.Fatal("expected preloaded parameters and explicit assumptions")
	}
}

func TestFromIntentRejectsUnsupportedGeometry(t *testing.T) {
	if _, err := FromIntent("simulate an aircraft wing"); err == nil {
		t.Fatal("expected unsupported geometry error")
	}
}

func TestWriteCylinderSTLIsWatertightFacetSet(t *testing.T) {
	blueprint, _ := FromIntent("cylinder flow")
	var output bytes.Buffer
	if err := WriteCylinderSTL(&output, blueprint.Geometry); err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(output.String(), "facet normal"); got != blueprint.Geometry.Segments*4 {
		t.Fatalf("got %d facets, want %d", got, blueprint.Geometry.Segments*4)
	}
	if !strings.HasSuffix(strings.TrimSpace(output.String()), "endsolid ai_create_cylinder") {
		t.Fatal("missing STL terminator")
	}
}
