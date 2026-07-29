package convergence

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoverCaseResultsWithNoDirectory(t *testing.T) {
	discovery, err := DiscoverCaseResults(t.Context(), "test-case", nil, os.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(discovery.Files) != 0 {
		t.Fatalf("expected 0 files, got %d", len(discovery.Files))
	}
}

func TestDiscoverCaseResultsWithLocalFiles(t *testing.T) {
	dir := t.TempDir()

	residualFile := filepath.Join(dir, "residuals.csv")
	if err := os.WriteFile(residualFile, []byte("iteration,time,continuity\n1,0.1,0.1\n2,0.2,0.01\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	forceFile := filepath.Join(dir, "forces.csv")
	if err := os.WriteFile(forceFile, []byte("iteration,time,Cl,Cd\n50,5.0,0.5,0.02\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	caseDir := filepath.Join(dir, "cases", "test-case")
	if err := os.MkdirAll(caseDir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := os.Rename(residualFile, filepath.Join(caseDir, "residuals.csv")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(forceFile, filepath.Join(caseDir, "forces.csv")); err != nil {
		t.Fatal(err)
	}

	discovery, err := DiscoverCaseResults(t.Context(), "test-case", nil, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(discovery.Files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(discovery.Files))
	}

	types := map[string]bool{}
	for _, f := range discovery.Files {
		types[f.Type] = true
	}
	if !types["residuals"] {
		t.Fatal("expected residuals file type")
	}
	if !types["forces"] {
		t.Fatal("expected forces file type")
	}
}

func TestDiscoveryAnalyzeResiduals(t *testing.T) {
	dir := t.TempDir()
	caseDir := filepath.Join(dir, "cases", "test-case")
	if err := os.MkdirAll(caseDir, 0o755); err != nil {
		t.Fatal(err)
	}

	var csvLines []string
	csvLines = append(csvLines, "iteration,time,continuity,x-momentum")
	for i := 0; i < 20; i++ {
		csvLines = append(csvLines, "1,0.1,1e-5,2e-5")
	}
	residualFile := filepath.Join(caseDir, "residuals.csv")
	if err := os.WriteFile(residualFile, []byte(joinLines(csvLines)), 0o644); err != nil {
		t.Fatal(err)
	}

	discovery, err := DiscoverCaseResults(t.Context(), "test-case", nil, dir)
	if err != nil {
		t.Fatal(err)
	}

	assessment, err := discovery.AnalyzeResiduals()
	if err != nil {
		t.Fatal(err)
	}
	if assessment.Status != StatusConverged {
		t.Fatalf("expected converged, got %s: %s", assessment.Status, assessment.Reason)
	}
}

func TestDiscoveryFullAssessment(t *testing.T) {
	dir := t.TempDir()
	caseDir := filepath.Join(dir, "cases", "test-case")
	if err := os.MkdirAll(caseDir, 0o755); err != nil {
		t.Fatal(err)
	}

	var csvLines []string
	csvLines = append(csvLines, "iteration,time,continuity")
	for i := 0; i < 10; i++ {
		csvLines = append(csvLines, "1,0.1,0.05")
	}
	residualFile := filepath.Join(caseDir, "residuals.csv")
	if err := os.WriteFile(residualFile, []byte(joinLines(csvLines)), 0o644); err != nil {
		t.Fatal(err)
	}

	discovery, err := DiscoverCaseResults(t.Context(), "test-case", nil, dir)
	if err != nil {
		t.Fatal(err)
	}

	assessments := discovery.FullAssessment()
	if len(assessments) < 1 {
		t.Fatal("expected at least one assessment")
	}
}

func TestClassifyResultFile(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"residuals.csv", "residuals"},
		{"forces.csv", "forces"},
		{"monitor.csv", "forces"},
		{"results.csv", "csv"},
		{"data.vtk", "mesh"},
		{"plot.dat", "data"},
		{"unknown.xyz", "other"},
	}

	for _, tt := range tests {
		got := classifyResultFile(tt.path)
		if got != tt.want {
			t.Errorf("classifyResultFile(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}

func joinLines(lines []string) string {
	result := ""
	for i, l := range lines {
		if i > 0 {
			result += "\n"
		}
		result += l
	}
	return result
}
