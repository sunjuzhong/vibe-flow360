package convergence

import (
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
)

const (
	StatusConverged        = "converged"
	StatusNotConverged     = "not-converged"
	StatusInsufficientData = "insufficient-data"
)

const (
	DefaultConvergenceTolerance = 1e-5
	DefaultStabilityWindow      = 50
	DefaultMaxOscillationRatio  = 0.1
	DefaultMinIterations        = 5
)

type Assessment struct {
	Status           string            `json:"status"`
	Reason           string            `json:"reason"`
	Metrics          map[string]Metric `json:"metrics"`
	WindowSize       int               `json:"window_size"`
	Threshold        float64           `json:"threshold"`
	EvidenceFiles    []string          `json:"evidence_files"`
	AlgorithmVersion string            `json:"algorithm_version"`
	Warnings         []string          `json:"warnings,omitempty"`
}

type Metric struct {
	Name        string  `json:"name"`
	Final       float64 `json:"final"`
	Min         float64 `json:"min"`
	Max         float64 `json:"max"`
	Mean        float64 `json:"mean"`
	Delta       float64 `json:"delta"`
	Stable      bool    `json:"stable"`
	Trend       string  `json:"trend"`
	Oscillating bool    `json:"oscillating"`
}

type ResidualRow struct {
	Iteration int
	Time      float64
	Residuals map[string]float64
}

type ForceRow struct {
	Iteration int
	Time      float64
	Forces    map[string]float64
}

type Analyzer struct {
	Tolerance      float64
	WindowSize     int
	MaxOscillation float64
	MinIterations  int
}

func NewAnalyzer() *Analyzer {
	return &Analyzer{
		Tolerance:      DefaultConvergenceTolerance,
		WindowSize:     DefaultStabilityWindow,
		MaxOscillation: DefaultMaxOscillationRatio,
		MinIterations:  DefaultMinIterations,
	}
}

func (a *Analyzer) AnalyzeResiduals(rows []ResidualRow) Assessment {
	if len(rows) < a.MinIterations {
		return Assessment{
			Status:           StatusInsufficientData,
			Reason:           fmt.Sprintf("only %d iterations available, need at least %d", len(rows), a.MinIterations),
			WindowSize:       a.WindowSize,
			Threshold:        a.Tolerance,
			AlgorithmVersion: "convergence-analyzer-v1",
			Warnings:         []string{"Not enough iterations for convergence assessment"},
		}
	}

	metrics := make(map[string]Metric)
	var allStable = true
	var anyOscillating = false
	var reasons []string

	residualKeys := sortedResidualKeys(rows)
	for _, key := range residualKeys {
		values := extractValues(rows, key)
		if len(values) == 0 {
			continue
		}
		metric := computeMetric(key, values, a)
		metrics[key] = metric

		if !metric.Stable {
			allStable = false
			reasons = append(reasons, fmt.Sprintf("%s not stable: drift=%.2e", key, metric.Delta))
		}
		if metric.Oscillating {
			anyOscillating = true
			reasons = append(reasons, fmt.Sprintf("%s oscillating", key))
		}
	}

	status := StatusConverged
	if !allStable {
		status = StatusNotConverged
	}
	if anyOscillating && !allStable {
		status = StatusNotConverged
	}

	if len(metrics) == 0 {
		return Assessment{
			Status:           StatusInsufficientData,
			Reason:           "no residual columns detected",
			Metrics:          map[string]Metric{},
			WindowSize:       a.WindowSize,
			Threshold:        a.Tolerance,
			AlgorithmVersion: "convergence-analyzer-v1",
		}
	}

	reason := "All residuals converged"
	if status == StatusNotConverged && len(reasons) > 0 {
		reason = strings.Join(reasons, "; ")
	}

	return Assessment{
		Status:           status,
		Reason:           reason,
		Metrics:          metrics,
		WindowSize:       a.WindowSize,
		Threshold:        a.Tolerance,
		AlgorithmVersion: "convergence-analyzer-v1",
		EvidenceFiles:    []string{"residuals.csv"},
	}
}

func (a *Analyzer) AnalyzeForces(rows []ForceRow) Assessment {
	if len(rows) < a.MinIterations {
		return Assessment{
			Status:           StatusInsufficientData,
			Reason:           fmt.Sprintf("only %d force samples available", len(rows)),
			WindowSize:       a.WindowSize,
			Threshold:        a.Tolerance,
			AlgorithmVersion: "convergence-analyzer-v1",
			Warnings:         []string{"Not enough force data for assessment"},
		}
	}

	metrics := make(map[string]Metric)
	var allStable = true

	forceKeys := sortedForceKeys(rows)
	for _, key := range forceKeys {
		values := extractForceValues(rows, key)
		if len(values) == 0 {
			continue
		}
		metric := computeMetric(key, values, a)
		metrics[key] = metric

		if !metric.Stable {
			allStable = false
		}
	}

	status := StatusConverged
	reason := "All forces stable"
	if !allStable {
		status = StatusNotConverged
		reason = "Force coefficients show drift or instability"
	}

	if len(metrics) == 0 {
		return Assessment{
			Status:           StatusInsufficientData,
			Reason:           "no force columns detected",
			Metrics:          map[string]Metric{},
			WindowSize:       a.WindowSize,
			Threshold:        a.Tolerance,
			AlgorithmVersion: "convergence-analyzer-v1",
		}
	}

	return Assessment{
		Status:           status,
		Reason:           reason,
		Metrics:          metrics,
		WindowSize:       a.WindowSize,
		Threshold:        a.Tolerance,
		AlgorithmVersion: "convergence-analyzer-v1",
		EvidenceFiles:    []string{"forces.csv"},
	}
}

func computeMetric(name string, values []float64, a *Analyzer) Metric {
	if len(values) == 0 {
		return Metric{Name: name}
	}

	var min, max, sum float64
	for _, v := range values {
		if v < min || min == 0 {
			min = v
		}
		if v > max {
			max = v
		}
		sum += v
	}
	mean := sum / float64(len(values))

	windowSize := a.WindowSize
	if len(values) < windowSize {
		windowSize = len(values)
	}
	window := values[len(values)-windowSize:]

	var windowMin, windowMax float64
	var windowSum float64
	for _, v := range window {
		if v < windowMin || windowMin == 0 {
			windowMin = v
		}
		if v > windowMax {
			windowMax = v
		}
		windowSum += v
	}
	_ = windowSum

	delta := math.Abs(windowMax - windowMin)
	rangeOf := math.Abs(max)
	if rangeOf < 1e-30 {
		rangeOf = 1
	}
	normalizedDelta := delta / rangeOf

	stable := normalizedDelta < a.MaxOscillation

	oscillating := false
	if normalizedDelta > a.MaxOscillation*2 && len(values) >= windowSize*2 {
		zeroCrossings := countZeroCrossings(values[len(values)-windowSize:], mean)
		if zeroCrossings >= len(values[len(values)-windowSize:])/10 {
			oscillating = true
		}
	}

	trend := "stable"
	if len(values) >= 2 {
		firstHalf := values[:len(values)/2]
		secondHalf := values[len(values)/2:]
		firstMean := avg(firstHalf)
		secondMean := avg(secondHalf)
		if secondMean < firstMean-a.Tolerance {
			trend = "decreasing"
		} else if secondMean > firstMean+a.Tolerance {
			trend = "increasing"
		}
	}

	return Metric{
		Name:        name,
		Final:       values[len(values)-1],
		Min:         min,
		Max:         max,
		Mean:        mean,
		Delta:       delta,
		Stable:      stable,
		Trend:       trend,
		Oscillating: oscillating,
	}
}

func avg(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

func sortedResidualKeys(rows []ResidualRow) []string {
	keySet := make(map[string]bool)
	for _, row := range rows {
		for k := range row.Residuals {
			keySet[k] = true
		}
	}
	keys := make([]string, 0, len(keySet))
	for k := range keySet {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sortedForceKeys(rows []ForceRow) []string {
	keySet := make(map[string]bool)
	for _, row := range rows {
		for k := range row.Forces {
			keySet[k] = true
		}
	}
	keys := make([]string, 0, len(keySet))
	for k := range keySet {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func extractValues(rows []ResidualRow, key string) []float64 {
	values := make([]float64, 0, len(rows))
	for _, row := range rows {
		if v, ok := row.Residuals[key]; ok {
			values = append(values, v)
		}
	}
	return values
}

func extractForceValues(rows []ForceRow, key string) []float64 {
	values := make([]float64, 0, len(rows))
	for _, row := range rows {
		if v, ok := row.Forces[key]; ok {
			values = append(values, v)
		}
	}
	return values
}

func ParseResidualsCSV(r io.Reader) ([]ResidualRow, error) {
	reader := csv.NewReader(r)
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1

	headers, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("reading headers: %w", err)
	}
	cleanHeaders := make([]string, len(headers))
	for i, h := range headers {
		cleanHeaders[i] = strings.TrimSpace(h)
	}

	iterIdx := indexOf(cleanHeaders, "iteration")
	timeIdx := indexOf(cleanHeaders, "time")

	var rows []ResidualRow
	lineNum := 1
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", lineNum+1, err)
		}
		lineNum++

		row := ResidualRow{Residuals: make(map[string]float64)}
		if iterIdx >= 0 && iterIdx < len(record) {
			if value, parseErr := strconv.Atoi(strings.TrimSpace(record[iterIdx])); parseErr == nil {
				row.Iteration = value
			}
		}
		if timeIdx >= 0 && timeIdx < len(record) {
			if value, parseErr := strconv.ParseFloat(strings.TrimSpace(record[timeIdx]), 64); parseErr == nil {
				row.Time = value
			}
		}
		for i, h := range cleanHeaders {
			if i >= len(record) {
				break
			}
			if h == "iteration" || h == "time" || h == "#" {
				continue
			}
			val := strings.TrimSpace(record[i])
			if val == "" {
				continue
			}
			var fval float64
			if _, err := fmt.Sscanf(val, "%f", &fval); err == nil {
				if !math.IsNaN(fval) {
					row.Residuals[h] = fval
				}
			}
		}
		rows = append(rows, row)
	}

	return rows, nil
}

func ParseForcesCSV(r io.Reader) ([]ForceRow, error) {
	reader := csv.NewReader(r)
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1

	headers, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("reading headers: %w", err)
	}
	cleanHeaders := make([]string, len(headers))
	for i, h := range headers {
		cleanHeaders[i] = strings.TrimSpace(h)
	}

	iterIdx := indexOf(cleanHeaders, "iteration")
	timeIdx := indexOf(cleanHeaders, "time")

	var rows []ForceRow
	lineNum := 1
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", lineNum+1, err)
		}
		lineNum++

		row := ForceRow{Forces: make(map[string]float64)}
		if iterIdx >= 0 && iterIdx < len(record) {
			if value, parseErr := strconv.Atoi(strings.TrimSpace(record[iterIdx])); parseErr == nil {
				row.Iteration = value
			}
		}
		if timeIdx >= 0 && timeIdx < len(record) {
			if value, parseErr := strconv.ParseFloat(strings.TrimSpace(record[timeIdx]), 64); parseErr == nil {
				row.Time = value
			}
		}
		for i, h := range cleanHeaders {
			if i >= len(record) {
				break
			}
			if h == "iteration" || h == "time" || h == "#" {
				continue
			}
			val := strings.TrimSpace(record[i])
			if val == "" {
				continue
			}
			var fval float64
			if _, err := fmt.Sscanf(val, "%f", &fval); err == nil {
				if !math.IsNaN(fval) {
					row.Forces[h] = fval
				}
			}
		}
		rows = append(rows, row)
	}

	return rows, nil
}

func indexOf(slice []string, item string) int {
	lower := strings.ToLower(item)
	for i, s := range slice {
		if strings.ToLower(s) == lower {
			return i
		}
	}
	return -1
}

func countZeroCrossings(values []float64, mean float64) int {
	crossings := 0
	above := values[0] > mean
	for i := 1; i < len(values); i++ {
		currentAbove := values[i] > mean
		if currentAbove != above {
			crossings++
			above = currentAbove
		}
	}
	return crossings
}

func NewAssessment(status, reason string) Assessment {
	return Assessment{
		Status:           status,
		Reason:           reason,
		Metrics:          map[string]Metric{},
		AlgorithmVersion: "convergence-analyzer-v1",
	}
}
