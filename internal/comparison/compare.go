package comparison

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/sjzsdu/vibesim/internal/convergence"
)

type CaseCompareInput struct {
	CaseIDs []string `json:"case_ids"`
}

type KPIData struct {
	Name      string  `json:"name"`
	Value     float64 `json:"value"`
	Unit      string  `json:"unit,omitempty"`
	Converged bool    `json:"converged"`
	Source    string  `json:"source"`
}

type DiffEntry struct {
	Path     string      `json:"path"`
	Baseline interface{} `json:"baseline"`
	Other    interface{} `json:"other"`
}

type CompareResult struct {
	Cases  []CaseComparison `json:"cases"`
	Diffs  []DiffEntry      `json:"diffs"`
	Ranking []RankedCase    `json:"ranking,omitempty"`
}

type CaseComparison struct {
	ID          string                `json:"id"`
	Name        string                `json:"name"`
	Status      string                `json:"status"`
	Params      map[string]interface{} `json:"params"`
	Convergence convergence.Assessment  `json:"convergence"`
	KPIs        []KPIData             `json:"kpis"`
}

type RankedCase struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Score       float64                `json:"score"`
	Reason      string                 `json:"reason"`
	Convergence convergence.Assessment  `json:"convergence"`
}

func CompareCases(baseline map[string]interface{}, others []map[string]interface{}, kpiKeys []string) CompareResult {
	var diffs []DiffEntry
	if len(others) > 0 {
		diffs = computeDiff(baseline, others[0], "")
	}

	result := CompareResult{
		Diffs: diffs,
	}

	for _, other := range others {
		cc := CaseComparison{
			ID:     caseIDFromParams(other),
			Name:   caseNameFromParams(other),
			Status: statusFromParams(other),
			Params: other,
			KPIs:   extractKPIs(other, kpiKeys),
		}
		result.Cases = append(result.Cases, cc)
	}

	return result
}

func computeDiff(a, b map[string]interface{}, prefix string) []DiffEntry {
	var diffs []DiffEntry

	aKeys := sortedKeys(a)
	bKeys := sortedKeys(b)

	for _, key := range aKeys {
		fullKey := joinPath(prefix, key)
		va := a[key]
		vb, exists := b[key]

		if !exists {
			diffs = append(diffs, DiffEntry{Path: fullKey, Baseline: va, Other: nil})
			continue
		}

		vaMap, vaIsMap := va.(map[string]interface{})
		vbMap, vbIsMap := vb.(map[string]interface{})

		if vaIsMap && vbIsMap {
			subDiffs := computeDiff(vaMap, vbMap, fullKey)
			diffs = append(diffs, subDiffs...)
			continue
		}

		if !jsonEqual(va, vb) {
			diffs = append(diffs, DiffEntry{Path: fullKey, Baseline: va, Other: vb})
		}
	}

	for _, key := range bKeys {
		if _, exists := a[key]; !exists {
			fullKey := joinPath(prefix, key)
			diffs = append(diffs, DiffEntry{Path: fullKey, Baseline: nil, Other: b[key]})
		}
	}

	return diffs
}

func sortedKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func joinPath(prefix, key string) string {
	if prefix == "" {
		return key
	}
	return prefix + "." + key
}

func jsonEqual(a, b interface{}) bool {
	aj, errA := json.Marshal(a)
	bj, errB := json.Marshal(b)
	if errA != nil || errB != nil {
		return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
	}
	return string(aj) == string(bj)
}

func extractKPIs(params map[string]interface{}, keys []string) []KPIData {
	var kpis []KPIData
	for _, key := range keys {
		val := findValue(params, key)
		if val == nil {
			continue
		}
		if num, ok := val.(float64); ok {
			kpis = append(kpis, KPIData{
				Name:      key,
				Value:     num,
				Unit:      inferUnit(key),
				Converged: false,
				Source:    "simulation_params",
			})
		}
	}
	return kpis
}

func findValue(m map[string]interface{}, key string) interface{} {
	lowerKey := strings.ToLower(key)
	for k, v := range m {
		if strings.ToLower(k) == lowerKey {
			return v
		}
	}
	for _, v := range m {
		if subMap, ok := v.(map[string]interface{}); ok {
			if found := findValue(subMap, key); found != nil {
				return found
			}
		}
	}
	return nil
}

func inferUnit(key string) string {
	lower := strings.ToLower(key)
	switch {
	case strings.Contains(lower, "cl"):
		return ""
	case strings.Contains(lower, "cd"):
		return ""
	case strings.Contains(lower, "cm"):
		return ""
	case strings.Contains(lower, "lift"):
		return ""
	case strings.Contains(lower, "drag"):
		return ""
	case strings.Contains(lower, "pressure"):
		return "Pa"
	case strings.Contains(lower, "temperature"):
		return "K"
	case strings.Contains(lower, "velocity"):
		return "m/s"
	default:
		return ""
	}
}

func caseIDFromParams(params map[string]interface{}) string {
	if id, ok := params["id"].(string); ok {
		return id
	}
	if id, ok := params["case_id"].(string); ok {
		return id
	}
	return ""
}

func caseNameFromParams(params map[string]interface{}) string {
	if name, ok := params["name"].(string); ok {
		return name
	}
	if name, ok := params["case_name"].(string); ok {
		return name
	}
	return "Unknown Case"
}

func statusFromParams(params map[string]interface{}) string {
	if status, ok := params["status"].(string); ok {
		return status
	}
	return "unknown"
}

func RankCases(cases []CaseComparison) []RankedCase {
	var ranked []RankedCase

	for _, c := range cases {
		score := 0.0
		reason := "Insufficient data for ranking"

		if c.Convergence.Status == convergence.StatusConverged {
			score = 100.0
			reason = "Fully converged"
		} else if c.Convergence.Status == convergence.StatusNotConverged {
			score = 40.0
			reason = "Not converged — results may be unreliable"
		}

		for _, kpi := range c.KPIs {
			if kpi.Converged {
				score += 5.0
			}
		}

		ranked = append(ranked, RankedCase{
			ID:          c.ID,
			Name:        c.Name,
			Score:       score,
			Reason:      reason,
			Convergence: c.Convergence,
		})
	}

	sort.Slice(ranked, func(i, j int) bool {
		return ranked[i].Score > ranked[j].Score
	})

	return ranked
}
