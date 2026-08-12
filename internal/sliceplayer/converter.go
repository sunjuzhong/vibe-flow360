package sliceplayer

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const (
	MaxConvertibleVTUBytes = int64(50 << 30)
	MaxDecodedArrayBytes   = int64(2 << 30)
)

type Playback struct {
	Ready         bool                  `json:"ready"`
	FrameCount    int                   `json:"frame_count"`
	Fields        []string              `json:"fields"`
	FieldRanges   map[string][2]float64 `json:"field_ranges"`
	Bounds        [2][3]float64         `json:"bounds"`
	Frames        []PlaybackFrame       `json:"frames"`
	CacheBytes    int64                 `json:"cache_bytes"`
	TopologyBytes int64                 `json:"topology_bytes"`
	FieldBytes    int64                 `json:"field_bytes"`
	TopologyCount int                   `json:"topology_count"`
}

type PlaybackFrame struct {
	Slice               string        `json:"slice"`
	Step                *int64        `json:"step,omitempty"`
	Fields              []string      `json:"fields"`
	ManifestPath        string        `json:"manifest_path"`
	Vertices            int           `json:"vertices"`
	Triangles           int           `json:"triangles"`
	Bounds              [2][3]float64 `json:"bounds"`
	PreviewManifestPath string        `json:"preview_manifest_path,omitempty"`
	PreviewVertices     int           `json:"preview_vertices,omitempty"`
	PreviewTriangles    int           `json:"preview_triangles,omitempty"`
}

type uvfSection struct {
	Name      string `json:"name"`
	DType     string `json:"dType"`
	Dimension int    `json:"dimension"`
	Offset    int64  `json:"offset"`
	Length    int64  `json:"length"`
	Path      string `json:"path,omitempty"`
}

type convertedPiece struct {
	Buffer              string
	Sections            []uvfSection
	Bounds              [2][3]float64
	Fields              map[string][2]float64
	Vertices, Triangles int
}

type frameBuild struct {
	Key           string
	AssetKey      string
	Slice         string
	Step          *int64
	Pieces        []convertedPiece
	PreviewPieces []convertedPiece
	HasPreview    bool
}

type pvtuDocument struct {
	Pieces []struct {
		Source string `xml:"Source,attr"`
	} `xml:"PUnstructuredGrid>Piece"`
}

type referencedFrame struct {
	Key   string
	Slice string
	Step  *int64
}

// ConvertTarGz converts VTU pieces sequentially. Only one archive entry is held
// in memory at a time; procN pieces become separate UVF solids in one frame.
func ConvertTarGz(filename, outputDir string, maxOutputBytes int64, cancelled func() bool) (Playback, error) {
	file, err := os.Open(filename)
	if err != nil {
		return Playback{}, err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return Playback{}, fmt.Errorf("open slice gzip stream: %w", err)
	}
	defer gz.Close()
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return Playback{}, err
	}
	frames := map[string]*frameBuild{}
	assetKeys := map[string]string{}
	pieceFrames := map[string]referencedFrame{}
	var outputBytes int64
	var playbackTopologyBytes int64
	var playbackFieldBytes int64
	topologies := map[string]int64{}
	reader := tar.NewReader(gz)
	for {
		header, nextErr := reader.Next()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			return Playback{}, nextErr
		}
		if cancelled != nil && cancelled() {
			return Playback{}, ErrCancelled
		}
		clean, cleanErr := safeArchivePath(header.Name)
		if cleanErr != nil {
			return Playback{}, cleanErr
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			continue
		}
		lowerName := strings.ToLower(clean)
		if strings.HasSuffix(lowerName, ".pvtu") {
			if header.Size <= 0 || header.Size > 1<<20 {
				return Playback{}, fmt.Errorf("PVTU manifest %q exceeds the 1 MiB metadata limit", clean)
			}
			payload, readErr := io.ReadAll(io.LimitReader(reader, header.Size+1))
			if readErr != nil {
				return Playback{}, readErr
			}
			if int64(len(payload)) != header.Size {
				return Playback{}, fmt.Errorf("PVTU manifest %q is truncated", clean)
			}
			var manifest pvtuDocument
			if err := xml.Unmarshal(payload, &manifest); err != nil {
				return Playback{}, fmt.Errorf("parse %s: %w", clean, err)
			}
			key, step := frameKey(clean)
			sliceName, _ := inferSliceAndStep(clean)
			for _, piece := range manifest.Pieces {
				source := strings.ReplaceAll(strings.TrimSpace(piece.Source), "\\", "/")
				sourceClean := path.Clean(source)
				if source == "" || path.IsAbs(source) || sourceClean == ".." || strings.HasPrefix(sourceClean, "../") {
					return Playback{}, fmt.Errorf("PVTU manifest %q contains unsafe Piece Source %q", clean, piece.Source)
				}
				joined, safeErr := safeArchivePath(path.Join(path.Dir(clean), sourceClean))
				if safeErr != nil {
					return Playback{}, safeErr
				}
				if existing, duplicate := pieceFrames[joined]; duplicate && existing.Key != key {
					return Playback{}, fmt.Errorf("VTU piece %q is referenced by multiple PVTU frames", joined)
				}
				pieceFrames[joined] = referencedFrame{Key: key, Slice: sliceName, Step: step}
			}
			continue
		}
		if !strings.HasSuffix(lowerName, ".vtu") {
			continue
		}
		if header.Size <= 0 || header.Size > MaxConvertibleVTUBytes {
			return Playback{}, fmt.Errorf("VTU entry %q exceeds the %d byte conversion limit", clean, MaxConvertibleVTUBytes)
		}
		key, step := frameKey(clean)
		sliceName, _ := inferSliceAndStep(clean)
		if referenced, ok := pieceFrames[clean]; ok {
			key, step = referenced.Key, referenced.Step
			sliceName = referenced.Slice
		}
		frame := frames[key]
		if frame == nil {
			assetKey := safeComponent(key)
			if existing, collision := assetKeys[assetKey]; collision && existing != key {
				return Playback{}, fmt.Errorf("time-series frame names %q and %q map to the same safe asset name", existing, key)
			}
			assetKeys[assetKey] = key
			frame = &frameBuild{Key: key, AssetKey: assetKey, Slice: sliceName, Step: step}
			frames[key] = frame
		}
		frameDir := filepath.Join(outputDir, frame.AssetKey)
		if err := os.MkdirAll(frameDir, 0o700); err != nil {
			return Playback{}, err
		}
		bufferName := fmt.Sprintf("piece-%04d.bin", len(frame.Pieces))
		document, streamErr := streamVTU(reader, header.Size, frameDir, cancelled)
		if streamErr != nil {
			return Playback{}, fmt.Errorf("stream %s: %w", clean, streamErr)
		}
		piece, convertErr := convertStreamedVTU(document, filepath.Join(frameDir, bufferName), bufferName, cancelled)
		document.Close()
		if convertErr != nil {
			return Playback{}, fmt.Errorf("convert %s: %w", clean, convertErr)
		}
		piece.Buffer = filepath.ToSlash(filepath.Join(frame.AssetKey, bufferName))
		_, topologyName, topologyBytes, fieldBytes, splitErr := splitTopologyBuffer(outputDir, filepath.Join(frameDir, bufferName), &piece)
		if splitErr != nil {
			return Playback{}, splitErr
		}
		_, topologySeen := topologies[topologyName]
		pieceBytes := fieldBytes
		if !topologySeen {
			pieceBytes += topologyBytes
		}
		if maxOutputBytes > 0 && pieceBytes > maxOutputBytes-outputBytes {
			_ = os.Remove(filepath.Join(frameDir, bufferName))
			return Playback{}, fmt.Errorf("playable frame cache exceeds the configured %d byte limit", maxOutputBytes)
		}
		outputBytes += pieceBytes
		if !topologySeen {
			topologies[topologyName] = topologyBytes
			playbackTopologyBytes += topologyBytes
		}
		playbackFieldBytes += fieldBytes
		frame.Pieces = append(frame.Pieces, piece)
		preview, generated, previewTopologyName, previewTopologyBytes, previewFieldBytes, previewErr := buildPreviewPiece(outputDir, frameDir, frame.AssetKey, len(frame.PreviewPieces), piece, cancelled)
		if previewErr != nil {
			return Playback{}, fmt.Errorf("build preview for %s: %w", clean, previewErr)
		}
		if generated {
			_, previewTopologySeen := topologies[previewTopologyName]
			previewBytes := previewFieldBytes
			if !previewTopologySeen {
				previewBytes += previewTopologyBytes
			}
			if maxOutputBytes > 0 && previewBytes > maxOutputBytes-outputBytes {
				return Playback{}, fmt.Errorf("playable preview cache exceeds the configured %d byte limit", maxOutputBytes)
			}
			outputBytes += previewBytes
			playbackFieldBytes += previewFieldBytes
			if !previewTopologySeen {
				topologies[previewTopologyName] = previewTopologyBytes
				playbackTopologyBytes += previewTopologyBytes
			}
			frame.HasPreview = true
		}
		frame.PreviewPieces = append(frame.PreviewPieces, preview)
	}
	keys := make([]string, 0, len(frames))
	for key := range frames {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := frames[keys[i]], frames[keys[j]]
		if a.Step != nil && b.Step != nil && *a.Step != *b.Step {
			return *a.Step < *b.Step
		}
		return keys[i] < keys[j]
	})
	playback := Playback{Fields: []string{}, FieldRanges: map[string][2]float64{}, CacheBytes: outputBytes, TopologyBytes: playbackTopologyBytes, FieldBytes: playbackFieldBytes, TopologyCount: len(topologies)}
	fieldSet := map[string]struct{}{}
	for _, key := range keys {
		frame := frames[key]
		manifest, summary, manifestErr := buildFrameManifest(frame)
		if manifestErr != nil {
			return Playback{}, manifestErr
		}
		manifestName := frame.AssetKey + ".manifest.json"
		encoded, marshalErr := json.MarshalIndent(manifest, "", "  ")
		if marshalErr != nil {
			return Playback{}, fmt.Errorf("encode frame manifest: %w", marshalErr)
		}
		if err := atomicWrite(filepath.Join(outputDir, manifestName), encoded); err != nil {
			return Playback{}, err
		}
		summary.ManifestPath = manifestName
		if frame.HasPreview {
			previewManifest, previewSummary, previewErr := buildFrameManifest(&frameBuild{Key: frame.Key, AssetKey: frame.AssetKey, Slice: frame.Slice, Step: frame.Step, Pieces: frame.PreviewPieces})
			if previewErr != nil {
				return Playback{}, previewErr
			}
			previewName := frame.AssetKey + ".preview.manifest.json"
			previewEncoded, encodeErr := json.MarshalIndent(previewManifest, "", "  ")
			if encodeErr != nil {
				return Playback{}, encodeErr
			}
			if err := atomicWrite(filepath.Join(outputDir, previewName), previewEncoded); err != nil {
				return Playback{}, err
			}
			summary.PreviewManifestPath = previewName
			summary.PreviewVertices = previewSummary.Vertices
			summary.PreviewTriangles = previewSummary.Triangles
		} else {
			summary.PreviewManifestPath = summary.ManifestPath
			summary.PreviewVertices = summary.Vertices
			summary.PreviewTriangles = summary.Triangles
		}
		playback.Frames = append(playback.Frames, summary)
		for _, piece := range frame.Pieces {
			for name := range piece.Fields {
				fieldSet[name] = struct{}{}
			}
			for name, bounds := range piece.Fields {
				previous, ok := playback.FieldRanges[name]
				if !ok {
					playback.FieldRanges[name] = bounds
				} else {
					if bounds[0] < previous[0] {
						previous[0] = bounds[0]
					}
					if bounds[1] > previous[1] {
						previous[1] = bounds[1]
					}
					playback.FieldRanges[name] = previous
				}
			}
		}
		playback.Bounds = mergeBounds(playback.Bounds, summary.Bounds, playback.FrameCount > 0)
		playback.FrameCount++
	}
	for field := range fieldSet {
		playback.Fields = append(playback.Fields, field)
	}
	sort.Strings(playback.Fields)
	playback.Ready = playback.FrameCount > 0
	if !playback.Ready {
		return Playback{}, errors.New("time-series archive contains no convertible VTU surface frames")
	}
	return playback, nil
}

func frameKey(name string) (string, *int64) {
	base := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	base = processorSuffix.ReplaceAllString(base, "")
	return base, parseTrailingStep(base)
}

func safeComponent(value string) string {
	var out strings.Builder
	for _, r := range value {
		if r == '-' || r == '_' || r >= '0' && r <= '9' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' {
			out.WriteRune(r)
		} else {
			out.WriteByte('_')
		}
	}
	if out.Len() == 0 {
		return "frame"
	}
	return out.String()
}

func splitTopologyBuffer(outputDir, combinedPath string, piece *convertedPiece) (addedBytes int64, topologyName string, topologyBytes, fieldBytes int64, err error) {
	if len(piece.Sections) < 2 || piece.Sections[0].Name != "indices" || piece.Sections[1].Name != "position" {
		return 0, "", 0, 0, errors.New("converted VTU is missing structural sections")
	}
	topologyBytes = piece.Sections[0].Length + piece.Sections[1].Length
	combined, err := os.Open(combinedPath)
	if err != nil {
		return 0, "", 0, 0, err
	}
	hash := sha256.New()
	if _, err = io.CopyN(hash, combined, topologyBytes); err != nil {
		combined.Close()
		return 0, "", 0, 0, err
	}
	topologyName = "topology-" + hex.EncodeToString(hash.Sum(nil)) + ".bin"
	topologyPath := filepath.Join(outputDir, topologyName)
	topologyAdded := int64(0)
	if _, statErr := os.Stat(topologyPath); errors.Is(statErr, os.ErrNotExist) {
		if _, err = combined.Seek(0, io.SeekStart); err != nil {
			combined.Close()
			return 0, "", 0, 0, err
		}
		temporary, createErr := os.CreateTemp(outputDir, ".topology-*")
		if createErr != nil {
			combined.Close()
			return 0, "", 0, 0, createErr
		}
		temporaryName := temporary.Name()
		if chmodErr := temporary.Chmod(0o600); chmodErr != nil {
			temporary.Close()
			os.Remove(temporaryName)
			combined.Close()
			return 0, "", 0, 0, chmodErr
		}
		_, copyErr := io.CopyN(temporary, combined, topologyBytes)
		closeErr := temporary.Close()
		if copyErr != nil || closeErr != nil {
			os.Remove(temporaryName)
			combined.Close()
			if copyErr != nil {
				return 0, "", 0, 0, copyErr
			}
			return 0, "", 0, 0, closeErr
		}
		if renameErr := os.Rename(temporaryName, topologyPath); renameErr != nil {
			os.Remove(temporaryName)
			combined.Close()
			return 0, "", 0, 0, renameErr
		}
		topologyAdded = topologyBytes
	} else if statErr != nil {
		combined.Close()
		return 0, "", 0, 0, statErr
	}
	info, err := combined.Stat()
	if err != nil {
		combined.Close()
		return 0, "", 0, 0, err
	}
	fieldBytes = info.Size() - topologyBytes
	for index := range piece.Sections {
		if index < 2 {
			piece.Sections[index].Path = topologyName
		} else {
			piece.Sections[index].Offset -= topologyBytes
		}
	}
	if fieldBytes == 0 {
		piece.Buffer = topologyName
		for index := range piece.Sections {
			piece.Sections[index].Path = ""
		}
		combined.Close()
		_ = os.Remove(combinedPath)
		return topologyAdded, topologyName, topologyBytes, 0, nil
	}
	if _, err = combined.Seek(topologyBytes, io.SeekStart); err != nil {
		combined.Close()
		return 0, "", 0, 0, err
	}
	fieldTemp, err := os.CreateTemp(filepath.Dir(combinedPath), ".fields-*")
	if err != nil {
		combined.Close()
		return 0, "", 0, 0, err
	}
	fieldTempName := fieldTemp.Name()
	_ = fieldTemp.Chmod(0o600)
	_, copyErr := io.Copy(fieldTemp, combined)
	closeErr := fieldTemp.Close()
	combined.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(fieldTempName)
		if copyErr != nil {
			return 0, "", 0, 0, copyErr
		}
		return 0, "", 0, 0, closeErr
	}
	if err = os.Rename(fieldTempName, combinedPath); err != nil {
		os.Remove(fieldTempName)
		return 0, "", 0, 0, err
	}
	return topologyAdded + fieldBytes, topologyName, topologyBytes, fieldBytes, nil
}

func mergeBounds(a, b [2][3]float64, set bool) [2][3]float64 {
	if !set {
		return b
	}
	for i := 0; i < 3; i++ {
		if b[0][i] < a[0][i] {
			a[0][i] = b[0][i]
		}
		if b[1][i] > a[1][i] {
			a[1][i] = b[1][i]
		}
	}
	return a
}

func buildFrameManifest(frame *frameBuild) ([]map[string]any, PlaybackFrame, error) {
	entries := []map[string]any{}
	summary := PlaybackFrame{Slice: frame.Slice, Step: frame.Step, Fields: []string{}}
	fieldSet := map[string]struct{}{}
	boundsSet := false
	for i, piece := range frame.Pieces {
		solidID := "piece-" + strconv.Itoa(i)
		faceID := "face-" + strconv.Itoa(i)
		entries = append(entries, map[string]any{"id": solidID, "name": solidID, "type": "SolidGeometry", "attributions": map[string]any{"faces": []string{faceID}}, "properties": map[string]any{"boundsMin": piece.Bounds[0], "boundsMax": piece.Bounds[1]}, "resources": map[string]any{"buffers": map[string]any{"type": "buffers", "path": piece.Buffer, "sections": piece.Sections, "bounds": piece.Fields}}}, map[string]any{"id": faceID, "name": frame.Key, "type": "Face", "attributions": map[string]any{"packedParentId": solidID}, "properties": map[string]any{"bufferLocations": map[string]any{"indices": []map[string]any{{"bufNum": 0, "startIndex": 0, "endIndex": piece.Triangles * 3}}}}})
		summary.Vertices += piece.Vertices
		summary.Triangles += piece.Triangles
		summary.Bounds = mergeBounds(summary.Bounds, piece.Bounds, boundsSet)
		for field := range piece.Fields {
			fieldSet[field] = struct{}{}
		}
		boundsSet = true
	}
	summary.Fields = sortedKeys(fieldSet)
	return entries, summary, nil
}
