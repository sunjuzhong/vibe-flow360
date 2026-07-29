package convergence

import (
	"strings"
	"testing"
)

func TestAnalyzeResidualsConverged(t *testing.T) {
	a := NewAnalyzer()
	rows := make([]ResidualRow, 100)
	for i := range rows {
		noise := float64(i%3) * 1e-8
		rows[i] = ResidualRow{
			Iteration: i,
			Time:      float64(i) * 0.1,
			Residuals: map[string]float64{
				"continuity": 1.0e-5 + noise,
				"x-momentum": 2.0e-5 + noise,
			},
		}
	}

	result := a.AnalyzeResiduals(rows)
	if result.Status != StatusConverged {
		t.Fatalf("expected converged, got %s: %s", result.Status, result.Reason)
	}
}

func TestAnalyzeResidualsNotConverged(t *testing.T) {
	a := NewAnalyzer()
	rows := make([]ResidualRow, 100)
	for i := range rows {
		rows[i] = ResidualRow{
			Iteration: i,
			Time:      float64(i) * 0.1,
			Residuals: map[string]float64{
				"continuity": 1.0 + float64(i)*0.01,
				"x-momentum": 2.0 + float64(i)*0.02,
			},
		}
	}

	result := a.AnalyzeResiduals(rows)
	if result.Status == StatusConverged {
		t.Fatalf("expected not-converged, got converged")
	}
}

func TestAnalyzeResidualsOscillating(t *testing.T) {
	a := NewAnalyzer()
	rows := make([]ResidualRow, 100)
	for i := range rows {
		rows[i] = ResidualRow{
			Iteration: i,
			Time:      float64(i) * 0.1,
			Residuals: map[string]float64{
				"continuity": 0.01 + 0.01*sin(float64(i)*0.5),
				"x-momentum": 0.02 + 0.02*sin(float64(i)*0.3),
			},
		}
	}

	result := a.AnalyzeResiduals(rows)
	if len(result.Metrics) == 0 {
		t.Fatal("expected metrics")
	}
	for _, m := range result.Metrics {
		if m.Oscillating {
			break
		}
	}
}

func TestAnalyzeResidualsInsufficientData(t *testing.T) {
	a := NewAnalyzer()
	rows := make([]ResidualRow, 2)
	rows[0] = ResidualRow{Iteration: 0, Residuals: map[string]float64{"continuity": 0.1}}
	rows[1] = ResidualRow{Iteration: 1, Residuals: map[string]float64{"continuity": 0.05}}

	result := a.AnalyzeResiduals(rows)
	if result.Status != StatusInsufficientData {
		t.Fatalf("expected insufficient-data, got %s", result.Status)
	}
}

func TestAnalyzeForcesStable(t *testing.T) {
	a := NewAnalyzer()
	rows := make([]ForceRow, 100)
	for i := range rows {
		rows[i] = ForceRow{
			Iteration: i,
			Time:      float64(i) * 0.1,
			Forces: map[string]float64{
				"Cl": 0.5 + 1e-5*float64(i),
				"Cd": 0.02 + 5e-6*float64(i),
			},
		}
	}

	result := a.AnalyzeForces(rows)
	if result.Status != StatusConverged {
		t.Fatalf("expected converged forces, got %s: %s", result.Status, result.Reason)
	}
}

func TestAnalyzeForcesDrifting(t *testing.T) {
	a := NewAnalyzer()
	rows := make([]ForceRow, 100)
	for i := range rows {
		rows[i] = ForceRow{
			Iteration: i,
			Time:      float64(i) * 0.1,
			Forces: map[string]float64{
				"Cl": 0.5 + float64(i)*0.005,
				"Cd": 0.02 + float64(i)*0.001,
			},
		}
	}

	result := a.AnalyzeForces(rows)
	if result.Status != StatusNotConverged {
		t.Fatalf("expected not-converged forces, got %s", result.Status)
	}
}

func TestParseResidualsCSV(t *testing.T) {
	csv := `iteration,time,continuity,x-momentum,y-momentum
1,0.1,0.1,0.2,0.3
2,0.2,0.05,0.1,0.15
3,0.3,0.01,0.02,0.03
`
	rows, err := ParseResidualsCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(rows))
	}
	if rows[0].Residuals["continuity"] != 0.1 {
		t.Fatalf("expected 0.1, got %f", rows[0].Residuals["continuity"])
	}
	if rows[2].Residuals["x-momentum"] != 0.02 {
		t.Fatalf("expected 0.02, got %f", rows[2].Residuals["x-momentum"])
	}
}

func TestParseForcesCSV(t *testing.T) {
	csv := `iteration,time,Cl,Cd,Cm
50,5.0,0.45,0.021,0.01
51,5.1,0.46,0.022,0.012
52,5.2,0.455,0.0215,0.011
`
	rows, err := ParseForcesCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(rows))
	}
	if rows[0].Forces["Cl"] != 0.45 {
		t.Fatalf("expected 0.45, got %f", rows[0].Forces["Cl"])
	}
}

func TestParseEmptyCSV(t *testing.T) {
	csv := `iteration,time
`
	rows, err := ParseResidualsCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected 0 rows, got %d", len(rows))
	}
}

func TestAssessmentJSONRoundTrip(t *testing.T) {
	a := NewAnalyzer()
	rows := make([]ResidualRow, 20)
	for i := range rows {
		rows[i] = ResidualRow{
			Iteration: i,
			Time:      float64(i),
			Residuals: map[string]float64{"continuity": 1e-5},
		}
	}

	result := a.AnalyzeResiduals(rows)
	if result.AlgorithmVersion == "" {
		t.Fatal("expected algorithm version")
	}
	if result.WindowSize < 1 {
		t.Fatal("expected window size > 0")
	}
}

func sin(x float64) float64 {
	return float64(int(x*100)%200-100) / 100.0
}
