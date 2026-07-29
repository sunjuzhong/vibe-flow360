package comparison

import (
	"fmt"
	"strings"
)

type SweepParameter struct {
	Name   string    `json:"name"`
	Values []float64 `json:"values"`
	Min    float64   `json:"min,omitempty"`
	Max    float64   `json:"max,omitempty"`
	Steps  int       `json:"steps,omitempty"`
}

type SweepPlan struct {
	ID             string            `json:"id"`
	BaselineCaseID string            `json:"baseline_case_id"`
	Parameters     []SweepParameter  `json:"parameters"`
	TotalCases     int               `json:"total_cases"`
	Combinations   [][]float64       `json:"combinations"`
	OverBudget     bool              `json:"over_budget"`
	MaxRecommended int               `json:"max_recommended"`
	Metadata       map[string]string `json:"metadata"`
}

const DefaultMaxSweepCases = 50
const WarningThreshold = 25

func GenerateSweepPlan(baselineID string, params []SweepParameter) SweepPlan {
	plan := SweepPlan{
		ID:             fmt.Sprintf("sweep-%s", baselineID),
		BaselineCaseID: baselineID,
		Parameters:     params,
		MaxRecommended: DefaultMaxSweepCases,
		Metadata:       map[string]string{},
	}

	if len(params) == 0 {
		plan.TotalCases = 0
		return plan
	}

	values := make([][]float64, len(params))
	for i, p := range params {
		if len(p.Values) > 0 {
			values[i] = p.Values
		} else if p.Steps > 1 {
			values[i] = generateRangeValues(p.Min, p.Max, p.Steps)
		} else {
			values[i] = []float64{p.Min}
		}
	}

	plan.Combinations = cartesianProduct(values)
	plan.TotalCases = len(plan.Combinations)
	plan.OverBudget = plan.TotalCases > DefaultMaxSweepCases

	if plan.TotalCases > WarningThreshold && plan.TotalCases <= DefaultMaxSweepCases {
		plan.Metadata["warning"] = fmt.Sprintf(
			"Large sweep: %d cases. Consider reducing parameters or ranges.",
			plan.TotalCases,
		)
	}

	return plan
}

func generateRangeValues(min, max float64, steps int) []float64 {
	if steps <= 1 {
		return []float64{min}
	}
	result := make([]float64, steps)
	step := (max - min) / float64(steps-1)
	for i := 0; i < steps; i++ {
		result[i] = min + step*float64(i)
	}
	return result
}

func cartesianProduct(lists [][]float64) [][]float64 {
	if len(lists) == 0 {
		return [][]float64{{}}
	}

	result := [][]float64{{}}
	for _, list := range lists {
		var newResult [][]float64
		for _, combo := range result {
			for _, val := range list {
				newCombo := make([]float64, len(combo)+1)
				copy(newCombo, combo)
				newCombo[len(combo)] = val
				newResult = append(newResult, newCombo)
			}
		}
		result = newResult
	}

	return result
}

func ValidateSweepPlan(plan SweepPlan) []string {
	warnings := make([]string, 0)

	for _, p := range plan.Parameters {
		if len(p.Name) == 0 {
			warnings = append(warnings, "Parameter name cannot be empty")
		}
		if len(p.Values) == 0 && p.Steps < 1 {
			warnings = append(warnings, fmt.Sprintf("Parameter %s has no values and no steps defined", p.Name))
		}
		if p.Steps > 100 {
			warnings = append(warnings, fmt.Sprintf("Parameter %s has too many steps (%d)", p.Name, p.Steps))
		}
	}

	if plan.TotalCases == 0 {
		warnings = append(warnings, "Sweep has no cases to generate")
	}
	if plan.TotalCases > DefaultMaxSweepCases {
		warnings = append(warnings, fmt.Sprintf(
			"Sweep exceeds maximum recommended size of %d cases (currently %d)",
			DefaultMaxSweepCases,
			plan.TotalCases,
		))
	}

	return warnings
}

func FormatCombination(params []SweepParameter, values []float64) string {
	var parts []string
	for i, p := range params {
		if i < len(values) {
			parts = append(parts, fmt.Sprintf("%s=%.4g", p.Name, values[i]))
		}
	}
	return strings.Join(parts, ", ")
}
