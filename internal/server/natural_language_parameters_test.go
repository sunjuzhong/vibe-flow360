package server

import (
	"strings"
	"testing"
)

func TestPlanAssistNaturalLanguageHintsMapsChineseCFL(t *testing.T) {
	hints := planAssistNaturalLanguageHints("把 CFL 降到 3，其他参数保持不变")
	for _, expected := range []string{`"concept":"case CFL"`, `"matched_alias":"cfl"`, `time_stepping.CFL`, `not a fluid-solver CFL_multiplier`} {
		if !strings.Contains(hints, expected) {
			t.Fatalf("CFL mapping is missing %q: %s", expected, hints)
		}
	}
}

func TestPlanAssistNaturalLanguageHintsMapsTurbulenceAliases(t *testing.T) {
	for _, prompt := range []string{"换成 k-omega 湍流模型", "Switch to k-ω SST", "使用 SA 模型"} {
		hints := planAssistNaturalLanguageHints(prompt)
		if !strings.Contains(hints, `models[*].turbulence_model_solver`) {
			t.Fatalf("turbulence path was not mapped for %q: %s", prompt, hints)
		}
		if strings.Contains(prompt, "SA") {
			if !strings.Contains(hints, `"canonical_term":"SpalartAllmaras"`) {
				t.Fatalf("SA canonical value was not mapped: %s", hints)
			}
		} else if !strings.Contains(hints, `"canonical_term":"kOmegaSST"`) {
			t.Fatalf("k-omega canonical value was not mapped: %s", hints)
		}
	}
}

func TestPlanAssistNaturalLanguageHintsDistinguishesCFLMultiplier(t *testing.T) {
	hints := planAssistNaturalLanguageHints("Set the CFL multiplier to 0.5")
	if !strings.Contains(hints, `models[*].navier_stokes_solver.CFL_multiplier`) {
		t.Fatalf("explicit CFL multiplier was not mapped: %s", hints)
	}
	if strings.Contains(hints, `time_stepping.CFL`) {
		t.Fatalf("explicit CFL multiplier was also mapped to case CFL: %s", hints)
	}
}

func TestPlanAssistNaturalLanguageHintsIgnoresUnmappedIntent(t *testing.T) {
	if hints := planAssistNaturalLanguageHints("Keep the current setup unchanged"); hints != "" {
		t.Fatalf("unmapped prompt unexpectedly produced hints: %s", hints)
	}
}
