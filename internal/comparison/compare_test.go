package comparison

import (
	"testing"

	"github.com/sjzsdu/vibesim/internal/convergence"
)

func TestCompareCasesDetectsDifferences(t *testing.T) {
	baseline := map[string]interface{}{
		"name":   "Case A",
		"status": "completed",
		"params": map[string]interface{}{
			"angle":    5.0,
			"mach":     0.8,
			"pressure": 101325.0,
		},
	}

	other := map[string]interface{}{
		"name":   "Case B",
		"status": "completed",
		"params": map[string]interface{}{
			"angle":    10.0,
			"mach":     0.8,
			"pressure": 101325.0,
		},
	}

	result := CompareCases(baseline, []map[string]interface{}{other}, []string{"Cl", "Cd", "Cm"})

	if len(result.Diffs) == 0 {
		t.Fatal("expected differences to be detected")
	}

	found := false
	for _, d := range result.Diffs {
		if d.Path == "params.angle" {
			if d.Baseline != 5.0 {
				t.Errorf("expected baseline 5.0, got %v", d.Baseline)
			}
			if d.Other != 10.0 {
				t.Errorf("expected other 10.0, got %v", d.Other)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("params.angle diff not found")
	}
}

func TestCompareCasesNoDifferences(t *testing.T) {
	baseline := map[string]interface{}{
		"name": "Case A",
		"params": map[string]interface{}{
			"angle": 5.0,
		},
	}

	other := map[string]interface{}{
		"name": "Case A",
		"params": map[string]interface{}{
			"angle": 5.0,
		},
	}

	result := CompareCases(baseline, []map[string]interface{}{other}, nil)

	if len(result.Diffs) != 0 {
		t.Fatalf("expected no differences, got %d", len(result.Diffs))
	}
}

func TestCompareCasesMissingKey(t *testing.T) {
	baseline := map[string]interface{}{
		"name": "Case A",
		"extra": "value",
	}

	other := map[string]interface{}{
		"name": "Case B",
	}

	result := CompareCases(baseline, []map[string]interface{}{other}, nil)

	found := false
	for _, d := range result.Diffs {
		if d.Path == "extra" && d.Baseline == "value" && d.Other == nil {
			found = true
		}
	}
	if !found {
		t.Fatal("missing key diff not detected")
	}
}

func TestRankCasesConvergedFirst(t *testing.T) {
	cases := []CaseComparison{
		{
			ID:     "case-1",
			Name:   "Converged Case",
			Status: "completed",
			Convergence: convergence.Assessment{
				Status: convergence.StatusConverged,
			},
		},
		{
			ID:     "case-2",
			Name:   "Diverged Case",
			Status: "completed",
			Convergence: convergence.Assessment{
				Status: convergence.StatusNotConverged,
			},
		},
	}

	ranked := RankCases(cases)
	if len(ranked) != 2 {
		t.Fatalf("expected 2 ranked cases, got %d", len(ranked))
	}

	if ranked[0].ID != "case-1" {
		t.Fatalf("expected converged case first, got %s", ranked[0].ID)
	}
}

func TestRankCasesInsufficientDataRankedLower(t *testing.T) {
	cases := []CaseComparison{
		{
			ID:     "case-1",
			Name:   "Stable Case",
			Status: "completed",
			Convergence: convergence.Assessment{
				Status: convergence.StatusConverged,
			},
			KPIs: []KPIData{
				{Name: "Cl", Value: 0.5, Converged: true},
			},
		},
		{
			ID:     "case-2",
			Name:   "No Data Case",
			Status: "completed",
			Convergence: convergence.Assessment{
				Status: convergence.StatusInsufficientData,
			},
		},
	}

	ranked := RankCases(cases)
	if ranked[0].ID != "case-1" {
		t.Fatalf("expected stable case first, got %s", ranked[0].ID)
	}
}

func TestGenerateSweepPlan(t *testing.T) {
	params := []SweepParameter{
		{Name: "angle", Values: []float64{0, 5, 10}},
		{Name: "mach", Values: []float64{0.5, 0.8}},
	}

	plan := GenerateSweepPlan("baseline-1", params)

	if plan.TotalCases != 6 {
		t.Fatalf("expected 6 combinations, got %d", plan.TotalCases)
	}
	if plan.OverBudget {
		t.Fatal("should not be over budget")
	}
}

func TestGenerateSweepPlanOverBudget(t *testing.T) {
	params := []SweepParameter{
		{Name: "angle", Values: generateRangeValues(-10, 10, 10)},
		{Name: "mach", Values: generateRangeValues(0.3, 1.0, 8)},
		{Name: "pressure", Values: generateRangeValues(80000, 120000, 7)},
	}

	plan := GenerateSweepPlan("baseline-1", params)

	if plan.TotalCases != 560 {
		t.Fatalf("expected 560 combinations, got %d", plan.TotalCases)
	}
	if !plan.OverBudget {
		t.Fatal("should be over budget")
	}
}

func TestGenerateSweepPlanEmptyParams(t *testing.T) {
	plan := GenerateSweepPlan("baseline-1", nil)

	if plan.TotalCases != 0 {
		t.Fatalf("expected 0 combinations, got %d", plan.TotalCases)
	}
}

func TestValidateSweepPlan(t *testing.T) {
	validParams := []SweepParameter{
		{Name: "angle", Values: []float64{0, 5, 10}},
	}

	plan := GenerateSweepPlan("baseline-1", validParams)
	warnings := ValidateSweepPlan(plan)

	if len(warnings) > 0 {
		t.Fatalf("expected no warnings, got %d", len(warnings))
	}

	badPlan := SweepPlan{
		Parameters: []SweepParameter{
			{Name: "", Values: []float64{1}},
		},
		TotalCases: 0,
	}
	badPlan.TotalCases = 0
	warnings = ValidateSweepPlan(badPlan)

	if len(warnings) == 0 {
		t.Fatal("expected warnings for invalid plan")
	}
}

func TestGenerateRangeValues(t *testing.T) {
	values := generateRangeValues(0, 10, 5)
	if len(values) != 5 {
		t.Fatalf("expected 5 values, got %d", len(values))
	}
	if values[0] != 0 {
		t.Errorf("expected first value 0, got %f", values[0])
	}
	if values[4] != 10 {
		t.Errorf("expected last value 10, got %f", values[4])
	}
}

func TestExtractKPIs(t *testing.T) {
	params := map[string]interface{}{
		"name": "test",
		"Cl":   0.45,
		"Cd":   0.021,
	}

	kpis := extractKPIs(params, []string{"Cl", "Cd", "Cm"})
	if len(kpis) != 2 {
		t.Fatalf("expected 2 KPIs, got %d", len(kpis))
	}
	if kpis[0].Name != "Cl" {
		t.Errorf("expected Cl, got %s", kpis[0].Name)
	}
	if kpis[0].Value != 0.45 {
		t.Errorf("expected 0.45, got %f", kpis[0].Value)
	}
}
