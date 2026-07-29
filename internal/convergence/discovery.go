package convergence

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/sjzsdu/vibesim/internal/flow360"
)

type ResultFile struct {
	Path    string `json:"path"`
	Type    string `json:"type"`
	Size    int64  `json:"size"`
}

type Discovery struct {
	CaseDir string
	Files   []ResultFile
}

func DiscoverCaseResults(ctx context.Context, caseID string, remoteClient *flow360.Client, workDir string) (*Discovery, error) {
	discovery := &Discovery{
		Files: []ResultFile{},
	}

	localDir := filepath.Join(workDir, "cases", caseID)
	info, err := os.Stat(localDir)
	if err == nil && info.IsDir() {
		if err := scanLocalDir(localDir, discovery); err != nil {
			return discovery, nil
		}
	}

	if remoteClient != nil {
		results, err := remoteClient.ListCaseResults(ctx, caseID)
		if err == nil {
			for _, r := range results {
				discovery.Files = append(discovery.Files, ResultFile{
					Path: r,
					Type: classifyResultFile(r),
				})
			}
		}
	}

	return discovery, nil
}

func scanLocalDir(dir string, discovery *Discovery) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		path := filepath.Join(dir, e.Name())
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.Size() > 50*1024*1024 {
			discovery.Files = append(discovery.Files, ResultFile{
				Path: path,
				Type: classifyResultFile(path),
				Size: info.Size(),
			})
			continue
		}
		discovery.Files = append(discovery.Files, ResultFile{
			Path: path,
			Type: classifyResultFile(path),
			Size: info.Size(),
		})
	}
	return nil
}

func classifyResultFile(path string) string {
	base := strings.ToLower(filepath.Base(path))
	if strings.Contains(base, "residual") {
		return "residuals"
	}
	if strings.Contains(base, "force") || strings.Contains(base, "monitor") {
		return "forces"
	}
	if strings.HasSuffix(base, ".csv") {
		return "csv"
	}
	if strings.HasSuffix(base, ".dat") || strings.HasSuffix(base, ".plt") {
		return "data"
	}
	if strings.HasSuffix(base, ".vtk") || strings.HasSuffix(base, ".vtu") {
		return "mesh"
	}
	return "other"
}

func (d *Discovery) AnalyzeResiduals() (Assessment, error) {
	for _, f := range d.Files {
		if f.Type == "residuals" {
			file, err := os.Open(f.Path)
			if err != nil {
				return NewAssessment(StatusInsufficientData, fmt.Sprintf("cannot open residual file: %s", err)), nil
			}
			defer file.Close()

			reader := io.LimitReader(file, 50*1024*1024)
			rows, err := ParseResidualsCSV(reader)
			if err != nil {
				return NewAssessment(StatusInsufficientData, fmt.Sprintf("parse residual CSV failed: %s", err)), nil
			}

			analyzer := NewAnalyzer()
			return analyzer.AnalyzeResiduals(rows), nil
		}
	}
	return NewAssessment(StatusInsufficientData, "no residual file found"), nil
}

func (d *Discovery) AnalyzeForces() (Assessment, error) {
	for _, f := range d.Files {
		if f.Type == "forces" {
			file, err := os.Open(f.Path)
			if err != nil {
				return NewAssessment(StatusInsufficientData, fmt.Sprintf("cannot open force file: %s", err)), nil
			}
			defer file.Close()

			reader := io.LimitReader(file, 50*1024*1024)
			rows, err := ParseForcesCSV(reader)
			if err != nil {
				return NewAssessment(StatusInsufficientData, fmt.Sprintf("parse force CSV failed: %s", err)), nil
			}

			analyzer := NewAnalyzer()
			return analyzer.AnalyzeForces(rows), nil
		}
	}
	return NewAssessment(StatusInsufficientData, "no force file found"), nil
}

func (d *Discovery) FullAssessment() map[string]Assessment {
	result := map[string]Assessment{}
	if a, err := d.AnalyzeResiduals(); err == nil {
		result["residuals"] = a
	}
	if a, err := d.AnalyzeForces(); err == nil {
		result["forces"] = a
	}
	if len(result) == 0 {
		result["overall"] = NewAssessment(StatusInsufficientData, "no result files found")
	}
	return result
}
