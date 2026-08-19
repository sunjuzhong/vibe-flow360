package sliceplayer

import (
	"archive/tar"
	"compress/gzip"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Version 7 invalidates previews built with triangle-stride sampling, which
// could leave visible holes and frame-dependent geometry bounds.
const IndexVersion = 7

type Limits struct {
	MaxEntries           int
	MaxUncompressedBytes int64
	MaxEntryBytes        int64
	MaxPathBytes         int
}

var DefaultLimits = Limits{
	MaxEntries:           200_000,
	MaxUncompressedBytes: 500 << 30,
	MaxEntryBytes:        50 << 30,
	MaxPathBytes:         4096,
}

type Entry struct {
	Path   string   `json:"path"`
	Size   int64    `json:"size"`
	Format string   `json:"format,omitempty"`
	Slice  string   `json:"slice,omitempty"`
	Step   *int64   `json:"step,omitempty"`
	Fields []string `json:"fields,omitempty"`
}

type SliceSummary struct {
	Name       string   `json:"name"`
	FrameCount int      `json:"frame_count"`
	FirstStep  *int64   `json:"first_step,omitempty"`
	LastStep   *int64   `json:"last_step,omitempty"`
	Formats    []string `json:"formats"`
	Fields     []string `json:"fields"`
}

type Index struct {
	Version           int            `json:"version"`
	CompressedBytes   int64          `json:"compressed_bytes"`
	UncompressedBytes int64          `json:"uncompressed_bytes"`
	EntryCount        int            `json:"entry_count"`
	Entries           []Entry        `json:"entries"`
	Slices            []SliceSummary `json:"slices"`
	Formats           []string       `json:"formats"`
	CreatedAt         time.Time      `json:"created_at"`
}

var ErrCancelled = errors.New("time-series archive scan cancelled")

type ProgressFunc func(percent int, compressedBytes int64) bool

type countingReader struct {
	r io.Reader
	n int64
}

func (r *countingReader) Read(buffer []byte) (int, error) {
	n, err := r.r.Read(buffer)
	r.n += int64(n)
	return n, err
}

var trailingStep = regexp.MustCompile(`(?:^|[_-])(\d{1,18})(?:\.[^.]+)?$`)
var processorSuffix = regexp.MustCompile(`(?i)_proc\d+$`)

func ScanTarGz(filename string, limits Limits, progress ProgressFunc) (Index, error) {
	limits = normalizeLimits(limits)
	file, err := os.Open(filename)
	if err != nil {
		return Index{}, fmt.Errorf("open time-series archive: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return Index{}, fmt.Errorf("inspect time-series archive: %w", err)
	}
	counter := &countingReader{r: file}
	gzipReader, err := gzip.NewReader(counter)
	if err != nil {
		return Index{}, fmt.Errorf("open slice gzip stream: %w", err)
	}
	defer gzipReader.Close()

	index := Index{Version: IndexVersion, CompressedBytes: info.Size(), CreatedAt: time.Now().UTC()}
	reader := tar.NewReader(gzipReader)
	for {
		header, nextErr := reader.Next()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			return Index{}, fmt.Errorf("scan time-series archive: %w", nextErr)
		}
		index.EntryCount++
		if index.EntryCount > limits.MaxEntries {
			return Index{}, fmt.Errorf("time-series archive exceeds %d entries", limits.MaxEntries)
		}
		if len(header.Name) > limits.MaxPathBytes {
			return Index{}, fmt.Errorf("time-series archive path exceeds %d bytes", limits.MaxPathBytes)
		}
		cleaned, cleanErr := safeArchivePath(header.Name)
		if cleanErr != nil {
			return Index{}, cleanErr
		}
		if header.Size < 0 || header.Size > limits.MaxEntryBytes {
			return Index{}, fmt.Errorf("time-series archive entry %q exceeds %d bytes", cleaned, limits.MaxEntryBytes)
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA && header.Typeflag != tar.TypeDir {
			return Index{}, fmt.Errorf("time-series archive entry %q has unsupported link or special-file type", cleaned)
		}
		if header.Typeflag == tar.TypeDir {
			continue
		}
		if header.Size > limits.MaxUncompressedBytes-index.UncompressedBytes {
			return Index{}, fmt.Errorf("time-series archive exceeds %d uncompressed bytes", limits.MaxUncompressedBytes)
		}
		index.UncompressedBytes += header.Size
		format := archiveFormat(cleaned)
		sliceName, step := inferSliceAndStep(cleaned)
		var fields []string
		if (format == "pvtu" || format == "pvtp") && header.Size <= 1<<20 {
			fields = parseParallelVTKFields(io.LimitReader(reader, header.Size))
		}
		index.Entries = append(index.Entries, Entry{Path: cleaned, Size: header.Size, Format: format, Slice: sliceName, Step: step, Fields: fields})
		if progress != nil && (index.EntryCount == 1 || index.EntryCount%128 == 0) {
			if !progress(progressPercent(counter.n, info.Size()), counter.n) {
				return Index{}, ErrCancelled
			}
		}
	}
	if err := gzipReader.Close(); err != nil {
		return Index{}, fmt.Errorf("verify slice gzip stream: %w", err)
	}
	index.Slices, index.Formats = summarize(index.Entries)
	if progress != nil {
		if !progress(100, counter.n) {
			return Index{}, ErrCancelled
		}
	}
	return index, nil
}

func normalizeLimits(limits Limits) Limits {
	if limits.MaxEntries <= 0 {
		limits.MaxEntries = DefaultLimits.MaxEntries
	}
	if limits.MaxUncompressedBytes <= 0 {
		limits.MaxUncompressedBytes = DefaultLimits.MaxUncompressedBytes
	}
	if limits.MaxEntryBytes <= 0 {
		limits.MaxEntryBytes = DefaultLimits.MaxEntryBytes
	}
	if limits.MaxPathBytes <= 0 {
		limits.MaxPathBytes = DefaultLimits.MaxPathBytes
	}
	return limits
}

func safeArchivePath(name string) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(name), "\\", "/")
	cleaned := path.Clean(normalized)
	if normalized == "" || cleaned == "." || path.IsAbs(normalized) || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("time-series archive contains unsafe path %q", name)
	}
	return cleaned, nil
}

func archiveFormat(filename string) string {
	lower := strings.ToLower(filename)
	for _, extension := range []string{".vtkhdf", ".szplt", ".pvtu", ".pvtp", ".vtu", ".vtp", ".vtk", ".pvd", ".case", ".geo", ".scl", ".vec"} {
		if strings.HasSuffix(lower, extension) {
			return strings.TrimPrefix(extension, ".")
		}
	}
	return ""
}

func inferSliceAndStep(filename string) (string, *int64) {
	parts := strings.Split(filename, "/")
	base := filepath.Base(filename)
	stem := strings.TrimSuffix(base, filepath.Ext(base))
	stem = processorSuffix.ReplaceAllString(stem, "")
	step := parseTrailingStep(stem)
	for _, part := range parts[:len(parts)-1] {
		lower := strings.ToLower(part)
		if strings.HasPrefix(lower, "slice_") || strings.HasPrefix(lower, "slice-") {
			return trimStepSuffix(strings.TrimSuffix(part, filepath.Ext(part))), step
		}
	}
	lowerStem := strings.ToLower(stem)
	if strings.Contains(lowerStem, "slice") || strings.Contains(lowerStem, "surface") || strings.Contains(lowerStem, "volume") {
		return trimStepSuffix(stem), step
	}
	return "", step
}

func parseTrailingStep(filename string) *int64 {
	match := trailingStep.FindStringSubmatch(filename)
	if len(match) != 2 {
		return nil
	}
	value, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return nil
	}
	return &value
}

func trimStepSuffix(value string) string {
	return strings.TrimSuffix(trailingStep.ReplaceAllString(value, ""), "_")
}

func progressPercent(read, total int64) int {
	if total <= 0 {
		return 0
	}
	percent := int(read * 100 / total)
	if percent > 99 {
		return 99
	}
	if percent < 0 {
		return 0
	}
	return percent
}

func summarize(entries []Entry) ([]SliceSummary, []string) {
	type aggregate struct {
		steps       map[int64]struct{}
		first, last *int64
		formats     map[string]struct{}
		fields      map[string]struct{}
	}
	groups := map[string]*aggregate{}
	formats := map[string]struct{}{}
	for _, entry := range entries {
		if entry.Format != "" {
			formats[entry.Format] = struct{}{}
		}
		if entry.Slice == "" {
			continue
		}
		group := groups[entry.Slice]
		if group == nil {
			group = &aggregate{steps: map[int64]struct{}{}, formats: map[string]struct{}{}, fields: map[string]struct{}{}}
			groups[entry.Slice] = group
		}
		if entry.Format != "" {
			group.formats[entry.Format] = struct{}{}
		}
		for _, field := range entry.Fields {
			group.fields[field] = struct{}{}
		}
		if entry.Step != nil {
			group.steps[*entry.Step] = struct{}{}
			if group.first == nil || *entry.Step < *group.first {
				value := *entry.Step
				group.first = &value
			}
			if group.last == nil || *entry.Step > *group.last {
				value := *entry.Step
				group.last = &value
			}
		}
	}
	slices := make([]SliceSummary, 0, len(groups))
	for name, group := range groups {
		count := len(group.steps)
		if count == 0 {
			count = 1
		}
		slices = append(slices, SliceSummary{Name: name, FrameCount: count, FirstStep: group.first, LastStep: group.last, Formats: sortedKeys(group.formats), Fields: sortedKeys(group.fields)})
	}
	sort.Slice(slices, func(i, j int) bool { return slices[i].Name < slices[j].Name })
	return slices, sortedKeys(formats)
}

func parseParallelVTKFields(reader io.Reader) []string {
	decoder := xml.NewDecoder(reader)
	fields := map[string]struct{}{}
	fieldDepth := 0
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch typed := token.(type) {
		case xml.StartElement:
			if typed.Name.Local == "PPointData" || typed.Name.Local == "PCellData" {
				fieldDepth = 1
				continue
			}
			if fieldDepth > 0 {
				fieldDepth++
			}
			if fieldDepth > 0 && typed.Name.Local == "PDataArray" {
				for _, attribute := range typed.Attr {
					if attribute.Name.Local == "Name" && strings.TrimSpace(attribute.Value) != "" {
						fields[strings.TrimSpace(attribute.Value)] = struct{}{}
					}
				}
			}
		case xml.EndElement:
			if fieldDepth > 0 {
				fieldDepth--
			}
		}
	}
	return sortedKeys(fields)
}

func sortedKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
