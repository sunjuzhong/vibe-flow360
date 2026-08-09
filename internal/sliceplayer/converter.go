package sliceplayer

import (
	"archive/tar"
	"compress/gzip"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const MaxConvertibleVTUBytes = int64(2 << 30)

type Playback struct {
	Ready       bool                  `json:"ready"`
	FrameCount  int                   `json:"frame_count"`
	Fields      []string              `json:"fields"`
	FieldRanges map[string][2]float64 `json:"field_ranges"`
	Bounds      [2][3]float64         `json:"bounds"`
	Frames      []PlaybackFrame       `json:"frames"`
}

type PlaybackFrame struct {
	Step         *int64        `json:"step,omitempty"`
	ManifestPath string        `json:"manifest_path"`
	Vertices     int           `json:"vertices"`
	Triangles    int           `json:"triangles"`
	Bounds       [2][3]float64 `json:"bounds"`
}

type vtkDataArray struct {
	Name       string `xml:"Name,attr"`
	Type       string `xml:"type,attr"`
	Components int    `xml:"NumberOfComponents,attr"`
	Format     string `xml:"format,attr"`
	Data       string `xml:",chardata"`
}

type vtkDocument struct {
	HeaderType string `xml:"header_type,attr"`
	Piece      struct {
		Points     int            `xml:"NumberOfPoints,attr"`
		Cells      int            `xml:"NumberOfCells,attr"`
		PointData  []vtkDataArray `xml:"PointData>DataArray"`
		PointsData []vtkDataArray `xml:"Points>DataArray"`
		CellsData  []vtkDataArray `xml:"Cells>DataArray"`
	} `xml:"UnstructuredGrid>Piece"`
}

type uvfSection struct {
	Name      string `json:"name"`
	DType     string `json:"dType"`
	Dimension int    `json:"dimension"`
	Offset    int64  `json:"offset"`
	Length    int64  `json:"length"`
}

type convertedPiece struct {
	Buffer              string
	Sections            []uvfSection
	Bounds              [2][3]float64
	Fields              map[string][2]float64
	Vertices, Triangles int
}

type frameBuild struct {
	Key    string
	Step   *int64
	Pieces []convertedPiece
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
	var outputBytes int64
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
		if !strings.HasSuffix(strings.ToLower(clean), ".vtu") {
			continue
		}
		if header.Size <= 0 || header.Size > MaxConvertibleVTUBytes {
			return Playback{}, fmt.Errorf("VTU entry %q exceeds the %d byte conversion limit", clean, MaxConvertibleVTUBytes)
		}
		payload, readErr := io.ReadAll(io.LimitReader(reader, header.Size+1))
		if readErr != nil {
			return Playback{}, readErr
		}
		if int64(len(payload)) != header.Size {
			return Playback{}, fmt.Errorf("VTU entry %q is truncated", clean)
		}
		key, step := frameKey(clean)
		frame := frames[key]
		if frame == nil {
			frame = &frameBuild{Key: key, Step: step}
			frames[key] = frame
		}
		frameDir := filepath.Join(outputDir, safeComponent(key))
		if err := os.MkdirAll(frameDir, 0o700); err != nil {
			return Playback{}, err
		}
		bufferName := fmt.Sprintf("piece-%04d.bin", len(frame.Pieces))
		piece, convertErr := convertVTU(payload, filepath.Join(frameDir, bufferName), bufferName)
		if convertErr != nil {
			return Playback{}, fmt.Errorf("convert %s: %w", clean, convertErr)
		}
		pieceBytes := int64(0)
		for _, section := range piece.Sections {
			pieceBytes += section.Length
		}
		if maxOutputBytes > 0 && pieceBytes > maxOutputBytes-outputBytes {
			_ = os.Remove(filepath.Join(frameDir, bufferName))
			return Playback{}, fmt.Errorf("playable frame cache exceeds the configured %d byte limit", maxOutputBytes)
		}
		outputBytes += pieceBytes
		frame.Pieces = append(frame.Pieces, piece)
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
	playback := Playback{Fields: []string{}, FieldRanges: map[string][2]float64{}}
	fieldSet := map[string]struct{}{}
	for _, key := range keys {
		frame := frames[key]
		manifest, summary, manifestErr := buildFrameManifest(frame)
		if manifestErr != nil {
			return Playback{}, manifestErr
		}
		frameDir := filepath.Join(outputDir, safeComponent(key))
		encoded, marshalErr := json.MarshalIndent(manifest, "", "  ")
		if marshalErr != nil {
			return Playback{}, fmt.Errorf("encode frame manifest: %w", marshalErr)
		}
		if err := atomicWrite(filepath.Join(frameDir, "manifest.json"), encoded); err != nil {
			return Playback{}, err
		}
		summary.ManifestPath = filepath.ToSlash(filepath.Join(safeComponent(key), "manifest.json"))
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
		return Playback{}, errors.New("slice archive contains no convertible VTU frames")
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

func convertVTU(payload []byte, target, bufferName string) (convertedPiece, error) {
	var document vtkDocument
	if err := xml.Unmarshal(payload, &document); err != nil {
		return convertedPiece{}, err
	}
	if document.Piece.Points <= 0 || len(document.Piece.PointsData) == 0 {
		return convertedPiece{}, errors.New("VTU has no points")
	}
	headerBytes := 8
	if strings.EqualFold(document.HeaderType, "UInt32") {
		headerBytes = 4
	}
	positions, err := decodeVTKBinary(document.Piece.PointsData[0], headerBytes)
	if err != nil {
		return convertedPiece{}, fmt.Errorf("decode points: %w", err)
	}
	if len(positions) != document.Piece.Points*3*4 {
		return convertedPiece{}, errors.New("point array length does not match NumberOfPoints")
	}
	cells := map[string][]byte{}
	for _, array := range document.Piece.CellsData {
		value, decodeErr := decodeVTKBinary(array, headerBytes)
		if decodeErr != nil {
			return convertedPiece{}, decodeErr
		}
		cells[array.Name] = value
	}
	indices, err := triangulateCells(cells["connectivity"], cells["offsets"], cells["types"])
	if err != nil {
		return convertedPiece{}, err
	}
	sections := []uvfSection{{Name: "indices", DType: "uint32", Dimension: 1, Offset: 0, Length: int64(len(indices))}, {Name: "position", DType: "float32", Dimension: 3, Offset: int64(len(indices)), Length: int64(len(positions))}}
	chunks := [][]byte{indices, positions}
	fields := map[string][2]float64{}
	offset := int64(len(indices) + len(positions))
	for _, array := range document.Piece.PointData {
		if array.Name == "" || !strings.EqualFold(array.Type, "Float32") {
			continue
		}
		values, decodeErr := decodeVTKBinary(array, headerBytes)
		if decodeErr != nil {
			return convertedPiece{}, fmt.Errorf("decode field %s: %w", array.Name, decodeErr)
		}
		components := array.Components
		if components <= 0 {
			components = 1
		}
		if len(values) != document.Piece.Points*components*4 {
			continue
		}
		sections = append(sections, uvfSection{Name: array.Name, DType: "float32", Dimension: components, Offset: offset, Length: int64(len(values))})
		chunks = append(chunks, values)
		offset += int64(len(values))
		fields[array.Name] = floatRange(values, components)
	}
	output, err := os.Create(target)
	if err != nil {
		return convertedPiece{}, err
	}
	for _, chunk := range chunks {
		if _, err = output.Write(chunk); err != nil {
			output.Close()
			return convertedPiece{}, err
		}
	}
	if err = output.Close(); err != nil {
		return convertedPiece{}, err
	}
	bounds, err := positionBounds(positions)
	if err != nil {
		return convertedPiece{}, err
	}
	return convertedPiece{Buffer: bufferName, Sections: sections, Bounds: bounds, Fields: fields, Vertices: document.Piece.Points, Triangles: len(indices) / 12}, nil
}

func decodeVTKBinary(array vtkDataArray, headerBytes int) ([]byte, error) {
	if !strings.EqualFold(array.Format, "binary") {
		return nil, errors.New("only inline binary VTU arrays are supported")
	}
	encoded := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\n' || r == '\r' || r == '\t' {
			return -1
		}
		return r
	}, array.Data)
	headerChars := base64.StdEncoding.EncodedLen(headerBytes)
	if len(encoded) < headerChars {
		return nil, errors.New("binary array has no length header")
	}
	header, err := base64.StdEncoding.DecodeString(encoded[:headerChars])
	if err != nil {
		return nil, err
	}
	var length uint64
	if headerBytes == 4 {
		length = uint64(binary.LittleEndian.Uint32(header))
	} else {
		length = binary.LittleEndian.Uint64(header)
	}
	if length > uint64(MaxConvertibleVTUBytes) {
		return nil, errors.New("decoded VTU array exceeds conversion limit")
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded[headerChars:])
	if err != nil {
		return nil, err
	}
	if uint64(len(decoded)) != length {
		return nil, fmt.Errorf("binary payload length is %d, expected %d", len(decoded), length)
	}
	return decoded, nil
}

func triangulateCells(connectivity, offsets, types []byte) ([]byte, error) {
	if len(connectivity)%4 != 0 || len(offsets)%4 != 0 || len(types) != len(offsets)/4 {
		return nil, errors.New("invalid VTU cell arrays")
	}
	conn := make([]uint32, len(connectivity)/4)
	for i := range conn {
		conn[i] = binary.LittleEndian.Uint32(connectivity[i*4:])
	}
	var triangles []uint32
	start := 0
	for i, cellType := range types {
		end := int(binary.LittleEndian.Uint32(offsets[i*4:]))
		if end < start || end > len(conn) {
			return nil, errors.New("invalid VTU cell offset")
		}
		cell := conn[start:end]
		switch cellType {
		case 5:
			if len(cell) == 3 {
				triangles = append(triangles, cell...)
			}
		case 9:
			if len(cell) == 4 {
				triangles = append(triangles, cell[0], cell[1], cell[2], cell[0], cell[2], cell[3])
			}
		case 7:
			for j := 1; j+1 < len(cell); j++ {
				triangles = append(triangles, cell[0], cell[j], cell[j+1])
			}
		}
		start = end
	}
	if len(triangles) == 0 {
		return nil, errors.New("VTU contains no triangle, quad, or polygon surface cells")
	}
	result := make([]byte, len(triangles)*4)
	for i, value := range triangles {
		binary.LittleEndian.PutUint32(result[i*4:], value)
	}
	return result, nil
}

func positionBounds(data []byte) ([2][3]float64, error) {
	var b [2][3]float64
	for a := 0; a < 3; a++ {
		b[0][a] = math.Inf(1)
		b[1][a] = math.Inf(-1)
	}
	for i := 0; i+11 < len(data); i += 12 {
		for a := 0; a < 3; a++ {
			v := float64(math.Float32frombits(binary.LittleEndian.Uint32(data[i+a*4:])))
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return [2][3]float64{}, errors.New("VTU contains non-finite point coordinates")
			}
			if v < b[0][a] {
				b[0][a] = v
			}
			if v > b[1][a] {
				b[1][a] = v
			}
		}
	}
	return b, nil
}
func floatRange(data []byte, components int) [2]float64 {
	result := [2]float64{math.Inf(1), math.Inf(-1)}
	for i := 0; i+components*4 <= len(data); i += components * 4 {
		value := 0.0
		for c := 0; c < components; c++ {
			v := float64(math.Float32frombits(binary.LittleEndian.Uint32(data[i+c*4:])))
			if components > 1 {
				value += v * v
			} else {
				value = v
			}
		}
		if components > 1 {
			value = math.Sqrt(value)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		if value < result[0] {
			result[0] = value
		}
		if value > result[1] {
			result[1] = value
		}
	}
	if math.IsInf(result[0], 0) || math.IsInf(result[1], 0) {
		return [2]float64{0, 0}
	}
	return result
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
	summary := PlaybackFrame{Step: frame.Step}
	boundsSet := false
	for i, piece := range frame.Pieces {
		solidID := "piece-" + strconv.Itoa(i)
		faceID := "face-" + strconv.Itoa(i)
		entries = append(entries, map[string]any{"id": solidID, "name": solidID, "type": "SolidGeometry", "attributions": map[string]any{"faces": []string{faceID}}, "properties": map[string]any{"boundsMin": piece.Bounds[0], "boundsMax": piece.Bounds[1]}, "resources": map[string]any{"buffers": map[string]any{"type": "buffers", "path": piece.Buffer, "sections": piece.Sections, "bounds": piece.Fields}}}, map[string]any{"id": faceID, "name": frame.Key, "type": "Face", "attributions": map[string]any{"packedParentId": solidID}, "properties": map[string]any{"bufferLocations": map[string]any{"indices": []map[string]any{{"bufNum": 0, "startIndex": 0, "endIndex": piece.Triangles * 3}}}}})
		summary.Vertices += piece.Vertices
		summary.Triangles += piece.Triangles
		summary.Bounds = mergeBounds(summary.Bounds, piece.Bounds, boundsSet)
		boundsSet = true
	}
	return entries, summary, nil
}
