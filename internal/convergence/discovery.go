package convergence

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
)

type ResultFile struct {
	Path string `json:"path"`
	Type string `json:"type"`
	Size int64  `json:"size"`
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

	residualPreference := 0
	forcePreference := 0
	for _, file := range discovery.Files {
		if file.Type == "residuals" {
			residualPreference = max(residualPreference, resultPreference(file.Path, "residuals"))
		}
		if file.Type == "forces" {
			forcePreference = max(forcePreference, resultPreference(file.Path, "forces"))
		}
	}

	if remoteClient != nil && (residualPreference < 30 || forcePreference < 30) {
		results, err := remoteClient.ListCaseResults(ctx, caseID)
		if err == nil {
			candidates := preferredRemoteResults(results)
			for resultType, r := range candidates {
				if resultType == "residuals" && residualPreference >= resultPreference(r, resultType) {
					continue
				}
				if resultType == "forces" && forcePreference >= resultPreference(r, resultType) {
					continue
				}
				localPath, downloadErr := remoteClient.DownloadCaseResultTo(
					ctx,
					caseID,
					r,
					localDir,
					50*1024*1024,
				)
				if downloadErr != nil {
					discovery.Files = append(discovery.Files, ResultFile{Path: r, Type: resultType})
					continue
				}
				info, _ := os.Stat(localPath)
				var size int64
				if info != nil {
					size = info.Size()
				}
				discovery.Files = append(discovery.Files, ResultFile{
					Path: localPath,
					Type: resultType,
					Size: size,
				})
				if resultType == "residuals" {
					residualPreference = resultPreference(localPath, resultType)
				}
				if resultType == "forces" {
					forcePreference = resultPreference(localPath, resultType)
				}
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
	if f, ok := preferredFile(d.Files, "residuals"); ok {
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
	return NewAssessment(StatusInsufficientData, "no residual file found"), nil
}

func (d *Discovery) AnalyzeForces() (Assessment, error) {
	if f, ok := preferredFile(d.Files, "forces"); ok {
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
	return NewAssessment(StatusInsufficientData, "no force file found"), nil
}

func preferredRemoteResults(results []string) map[string]string {
	selected := map[string]string{}
	for _, path := range results {
		kind := classifyResultFile(path)
		if kind != "residuals" && kind != "forces" {
			continue
		}
		current := selected[kind]
		if current == "" || resultPreference(path, kind) > resultPreference(current, kind) {
			selected[kind] = path
		}
	}
	return selected
}

func preferredFile(files []ResultFile, kind string) (ResultFile, bool) {
	var selected ResultFile
	found := false
	for _, file := range files {
		if file.Type != kind {
			continue
		}
		if !found || resultPreference(file.Path, kind) > resultPreference(selected.Path, kind) {
			selected = file
			found = true
		}
	}
	return selected, found
}

func resultPreference(path, kind string) int {
	name := strings.ToLower(filepath.Base(path))
	switch kind {
	case "residuals":
		switch {
		case strings.Contains(name, "nonlinear_residual"):
			return 30
		case strings.Contains(name, "linear_residual"):
			return 20
		default:
			return 10
		}
	case "forces":
		switch {
		case strings.Contains(name, "total_forces"):
			return 30
		case strings.Contains(name, "surface_forces"):
			return 20
		default:
			return 10
		}
	}
	return 0
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
