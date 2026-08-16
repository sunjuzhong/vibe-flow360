package agentskills

import (
	"strings"
	"testing"
)

func TestInstructionsAreStageScopedAndVersioned(t *testing.T) {
	cad := Instructions(CADDesign)
	if !strings.Contains(cad, CatalogVersion) || !strings.Contains(cad, "flow360-cad-design") || !strings.Contains(cad, "flow360-external-aero-cad") || strings.Contains(cad, "flow360-preflight-repair") {
		t.Fatalf("unexpected CAD skill bundle: %s", cad)
	}
	repair := Instructions(PreflightRepair)
	for _, expected := range []string{"flow360-parameter-authoring", "flow360-preflight-repair", "Accumulate corrections across attempts", "never guess IDs"} {
		if !strings.Contains(repair, expected) {
			t.Fatalf("repair skill bundle is missing %q: %s", expected, repair)
		}
	}
	if strings.Contains(repair, "TODO") {
		t.Fatalf("runtime skill contains template text: %s", repair)
	}
}

func TestUnknownStageHasNoInstructions(t *testing.T) {
	if got := Instructions(Stage("unknown")); got != "" {
		t.Fatalf("unexpected unknown-stage instructions: %q", got)
	}
}
