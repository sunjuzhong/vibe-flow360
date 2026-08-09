package sliceplayer

import (
	"bufio"
	"encoding/base64"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

const streamBufferBytes = 64 << 10

type streamedArray struct {
	Name       string
	DType      string
	Components int
	Section    string
	Path       string
	Bytes      int64
}

type streamedVTU struct {
	Points int
	Cells  int
	Arrays []streamedArray
	root   string
}

func (v *streamedVTU) Close() { _ = os.RemoveAll(v.root) }

func streamVTU(reader io.Reader, entryBytes int64, parent string, cancelled func() bool) (*streamedVTU, error) {
	root, err := os.MkdirTemp(parent, ".vtu-stream-*")
	if err != nil {
		return nil, err
	}
	document := &streamedVTU{root: root}
	fail := func(cause error) (*streamedVTU, error) { document.Close(); return nil, cause }
	buffered := bufio.NewReaderSize(io.LimitReader(reader, entryBytes), streamBufferBytes)
	headerBytes := 8
	section := ""
	arrayIndex := 0
	for {
		if cancelled != nil && cancelled() {
			return fail(ErrCancelled)
		}
		tag, tagErr := nextXMLTag(buffered)
		if errors.Is(tagErr, io.EOF) {
			break
		}
		if tagErr != nil {
			return fail(tagErr)
		}
		trimmed := strings.TrimSpace(tag)
		if strings.HasPrefix(trimmed, "<?") || strings.HasPrefix(trimmed, "<!--") {
			continue
		}
		if strings.HasPrefix(trimmed, "</") {
			name := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(trimmed, "</"), ">"))
			if name == section {
				section = ""
			}
			continue
		}
		start, parseErr := parseXMLStart(trimmed)
		if parseErr != nil {
			return fail(parseErr)
		}
		switch start.Name.Local {
		case "VTKFile":
			if attribute(start, "compressor") != "" {
				return fail(errors.New("compressed VTU arrays are not supported"))
			}
			if strings.EqualFold(attribute(start, "header_type"), "UInt32") {
				headerBytes = 4
			}
		case "Piece":
			document.Points, err = positiveXMLInt(start, "NumberOfPoints")
			if err != nil {
				return fail(err)
			}
			document.Cells, err = positiveXMLInt(start, "NumberOfCells")
			if err != nil {
				return fail(err)
			}
		case "PointData", "Points", "Cells":
			section = start.Name.Local
		case "DataArray":
			if strings.EqualFold(attribute(start, "format"), "appended") {
				return fail(errors.New("appended VTU arrays are not supported"))
			}
			if !strings.EqualFold(attribute(start, "format"), "binary") {
				return fail(errors.New("only inline binary VTU arrays are supported"))
			}
			components := 1
			if raw := attribute(start, "NumberOfComponents"); raw != "" {
				if _, scanErr := fmt.Sscan(raw, &components); scanErr != nil || components <= 0 || components > 64 {
					return fail(errors.New("invalid VTU component count"))
				}
			}
			target := filepath.Join(root, fmt.Sprintf("array-%04d.bin", arrayIndex))
			arrayIndex++
			decodedBytes, decodeErr := decodeInlineVTKArray(buffered, headerBytes, target, cancelled)
			if decodeErr != nil {
				return fail(decodeErr)
			}
			document.Arrays = append(document.Arrays, streamedArray{Name: attribute(start, "Name"), DType: attribute(start, "type"), Components: components, Section: section, Path: target, Bytes: decodedBytes})
		}
	}
	if document.Points <= 0 || document.Cells <= 0 {
		return fail(errors.New("VTU Piece metadata is missing"))
	}
	return document, nil
}

func nextXMLTag(reader *bufio.Reader) (string, error) {
	for {
		chunk, err := reader.ReadString('<')
		if err != nil {
			return "", err
		}
		if len(chunk) == 0 || chunk[len(chunk)-1] != '<' {
			continue
		}
		rest, restErr := reader.ReadString('>')
		if restErr != nil {
			return "", restErr
		}
		return "<" + rest, nil
	}
}

func parseXMLStart(tag string) (xml.StartElement, error) {
	decoder := xml.NewDecoder(strings.NewReader(tag))
	token, err := decoder.Token()
	if err != nil {
		return xml.StartElement{}, fmt.Errorf("parse VTU tag: %w", err)
	}
	start, ok := token.(xml.StartElement)
	if !ok {
		return xml.StartElement{}, errors.New("invalid VTU start tag")
	}
	return start, nil
}

func attribute(start xml.StartElement, name string) string {
	for _, item := range start.Attr {
		if item.Name.Local == name {
			return strings.TrimSpace(item.Value)
		}
	}
	return ""
}

func positiveXMLInt(start xml.StartElement, name string) (int, error) {
	value := 0
	if _, err := fmt.Sscan(attribute(start, name), &value); err != nil || value <= 0 {
		return 0, fmt.Errorf("invalid VTU %s", name)
	}
	return value, nil
}

type vtkBase64Decoder struct {
	headerBytes int
	header      []byte
	pending     []byte
	expected    uint64
	written     uint64
	ready       bool
	output      io.Writer
}

func (d *vtkBase64Decoder) WriteEncoded(chunk []byte) error {
	filtered := make([]byte, 0, len(chunk))
	for _, value := range chunk {
		switch value {
		case ' ', '\n', '\r', '\t':
		default:
			filtered = append(filtered, value)
		}
	}
	headerChars := base64.StdEncoding.EncodedLen(d.headerBytes)
	if !d.ready {
		need := headerChars - len(d.header)
		if need > len(filtered) {
			need = len(filtered)
		}
		d.header = append(d.header, filtered[:need]...)
		filtered = filtered[need:]
		if len(d.header) == headerChars {
			decoded, err := base64.StdEncoding.DecodeString(string(d.header))
			if err != nil {
				return err
			}
			if d.headerBytes == 4 {
				d.expected = uint64(binary.LittleEndian.Uint32(decoded))
			} else {
				d.expected = binary.LittleEndian.Uint64(decoded)
			}
			if d.expected > uint64(MaxDecodedArrayBytes) {
				return errors.New("decoded VTU array exceeds conversion limit")
			}
			d.ready = true
		}
	}
	if !d.ready || len(filtered) == 0 {
		return nil
	}
	d.pending = append(d.pending, filtered...)
	decodeBytes := len(d.pending) / 4 * 4
	if decodeBytes == 0 {
		return nil
	}
	decoded := make([]byte, base64.StdEncoding.DecodedLen(decodeBytes))
	n, err := base64.StdEncoding.Decode(decoded, d.pending[:decodeBytes])
	if err != nil {
		return err
	}
	if d.written+uint64(n) > d.expected {
		return errors.New("VTU array exceeds its declared length")
	}
	if _, err := d.output.Write(decoded[:n]); err != nil {
		return err
	}
	d.written += uint64(n)
	d.pending = append(d.pending[:0], d.pending[decodeBytes:]...)
	return nil
}

func (d *vtkBase64Decoder) Finish() (int64, error) {
	if !d.ready {
		return 0, errors.New("binary array has no length header")
	}
	if len(d.pending) != 0 {
		return 0, errors.New("binary VTU payload is not aligned to base64 quanta")
	}
	if d.written != d.expected {
		return 0, fmt.Errorf("binary payload length is %d, expected %d", d.written, d.expected)
	}
	return int64(d.written), nil
}

func decodeInlineVTKArray(reader *bufio.Reader, headerBytes int, target string, cancelled func() bool) (int64, error) {
	file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	decoder := vtkBase64Decoder{headerBytes: headerBytes, output: file}
	for {
		if cancelled != nil && cancelled() {
			file.Close()
			return 0, ErrCancelled
		}
		chunk, readErr := reader.ReadSlice('<')
		hasDelimiter := readErr == nil && len(chunk) > 0 && chunk[len(chunk)-1] == '<'
		if hasDelimiter {
			chunk = chunk[:len(chunk)-1]
		}
		if err := decoder.WriteEncoded(chunk); err != nil {
			file.Close()
			return 0, err
		}
		if hasDelimiter {
			closing, closeErr := reader.ReadString('>')
			if closeErr != nil {
				file.Close()
				return 0, closeErr
			}
			if strings.TrimSpace(closing) != "/DataArray>" {
				file.Close()
				return 0, errors.New("VTU DataArray has malformed closing tag")
			}
			break
		}
		if readErr != nil && !errors.Is(readErr, bufio.ErrBufferFull) {
			file.Close()
			return 0, readErr
		}
	}
	bytesWritten, finishErr := decoder.Finish()
	if closeErr := file.Close(); finishErr == nil {
		finishErr = closeErr
	}
	return bytesWritten, finishErr
}

func convertStreamedVTU(document *streamedVTU, target, bufferName string, cancelled func() bool) (convertedPiece, error) {
	var position *streamedArray
	fields := []streamedArray{}
	cells := map[string]streamedArray{}
	for index := range document.Arrays {
		array := &document.Arrays[index]
		switch array.Section {
		case "Points":
			if position == nil {
				position = array
			}
		case "PointData":
			if array.Name != "" && strings.EqualFold(array.DType, "Float32") {
				fields = append(fields, *array)
			}
		case "Cells":
			cells[array.Name] = *array
		}
	}
	if position == nil || !strings.EqualFold(position.DType, "Float32") || position.Components != 3 || position.Bytes != int64(document.Points)*12 {
		return convertedPiece{}, errors.New("VTU point array does not match Piece metadata")
	}
	indicesPath := filepath.Join(document.root, "triangles.bin")
	triangles, err := triangulateStreamedCells(cells["connectivity"], cells["offsets"], cells["types"], document.Cells, indicesPath, cancelled)
	if err != nil {
		return convertedPiece{}, err
	}
	indexInfo, err := os.Stat(indicesPath)
	if err != nil {
		return convertedPiece{}, err
	}
	bounds, err := streamedPositionBounds(position.Path, cancelled)
	if err != nil {
		return convertedPiece{}, err
	}
	sections := []uvfSection{{Name: "indices", DType: "uint32", Dimension: 1, Offset: 0, Length: indexInfo.Size()}, {Name: "position", DType: "float32", Dimension: 3, Offset: indexInfo.Size(), Length: position.Bytes}}
	fieldBounds := map[string][2]float64{}
	offset := indexInfo.Size() + position.Bytes
	validFields := []streamedArray{}
	for _, field := range fields {
		if field.Bytes != int64(document.Points*field.Components*4) {
			continue
		}
		rangeValue, rangeErr := streamedFloatRange(field.Path, field.Components, cancelled)
		if rangeErr != nil {
			return convertedPiece{}, rangeErr
		}
		sections = append(sections, uvfSection{Name: field.Name, DType: "float32", Dimension: field.Components, Offset: offset, Length: field.Bytes})
		offset += field.Bytes
		fieldBounds[field.Name] = rangeValue
		validFields = append(validFields, field)
	}
	output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return convertedPiece{}, err
	}
	copyFile := func(path string) error {
		source, openErr := os.Open(path)
		if openErr != nil {
			return openErr
		}
		_, copyErr := io.CopyBuffer(output, source, make([]byte, streamBufferBytes))
		closeErr := source.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	}
	for _, path := range append([]string{indicesPath, position.Path}, func() []string {
		result := []string{}
		for _, field := range validFields {
			result = append(result, field.Path)
		}
		return result
	}()...) {
		if err := copyFile(path); err != nil {
			output.Close()
			return convertedPiece{}, err
		}
	}
	if err := output.Close(); err != nil {
		return convertedPiece{}, err
	}
	return convertedPiece{Buffer: bufferName, Sections: sections, Bounds: bounds, Fields: fieldBounds, Vertices: document.Points, Triangles: triangles}, nil
}

func triangulateStreamedCells(connectivity, offsets, types streamedArray, cellCount int, target string, cancelled func() bool) (int, error) {
	if connectivity.Path == "" || offsets.Path == "" || types.Path == "" || connectivity.Bytes%4 != 0 || offsets.Bytes != int64(cellCount*4) || types.Bytes != int64(cellCount) {
		return 0, errors.New("invalid VTU cell arrays")
	}
	conn, err := os.Open(connectivity.Path)
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	off, err := os.Open(offsets.Path)
	if err != nil {
		return 0, err
	}
	defer off.Close()
	typ, err := os.Open(types.Path)
	if err != nil {
		return 0, err
	}
	defer typ.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	defer output.Close()
	writer := bufio.NewWriterSize(output, streamBufferBytes)
	defer writer.Flush()
	start := 0
	triangles := 0
	offsetBuffer := make([]byte, 4)
	typeBuffer := make([]byte, 1)
	cellBytes := make([]byte, 0, 16)
	cell := make([]uint32, 0, 4)
	for cellIndex := 0; cellIndex < cellCount; cellIndex++ {
		if cellIndex%4096 == 0 && cancelled != nil && cancelled() {
			return 0, ErrCancelled
		}
		if _, err = io.ReadFull(off, offsetBuffer); err != nil {
			return 0, err
		}
		if _, err = io.ReadFull(typ, typeBuffer); err != nil {
			return 0, err
		}
		end := int(binary.LittleEndian.Uint32(offsetBuffer))
		if end < start || end-start > 1_000_000 {
			return 0, errors.New("invalid or oversized VTU cell")
		}
		byteCount := (end - start) * 4
		if cap(cellBytes) < byteCount {
			cellBytes = make([]byte, byteCount)
		} else {
			cellBytes = cellBytes[:byteCount]
		}
		if _, err = io.ReadFull(conn, cellBytes); err != nil {
			return 0, err
		}
		pointCount := len(cellBytes) / 4
		if cap(cell) < pointCount {
			cell = make([]uint32, pointCount)
		} else {
			cell = cell[:pointCount]
		}
		for i := range cell {
			cell[i] = binary.LittleEndian.Uint32(cellBytes[i*4:])
		}
		emit := func(values ...uint32) error {
			if len(values) != 3 {
				return errors.New("internal triangulation produced a non-triangle")
			}
			encoded := [12]byte{}
			for index, value := range values {
				binary.LittleEndian.PutUint32(encoded[index*4:], value)
			}
			if _, err := writer.Write(encoded[:]); err != nil {
				return err
			}
			triangles++
			return nil
		}
		switch typeBuffer[0] {
		case 5:
			if len(cell) == 3 {
				if err := emit(cell...); err != nil {
					return 0, err
				}
			}
		case 9:
			if len(cell) == 4 {
				if err := emit(cell[0], cell[1], cell[2]); err != nil {
					return 0, err
				}
				if err := emit(cell[0], cell[2], cell[3]); err != nil {
					return 0, err
				}
			}
		case 7:
			for i := 1; i+1 < len(cell); i++ {
				if err := emit(cell[0], cell[i], cell[i+1]); err != nil {
					return 0, err
				}
			}
		}
		start = end
	}
	if start*4 != int(connectivity.Bytes) || triangles == 0 {
		return 0, errors.New("VTU contains no valid surface triangles")
	}
	if err := writer.Flush(); err != nil {
		return 0, err
	}
	return triangles, nil
}

func streamedPositionBounds(path string, cancelled func() bool) ([2][3]float64, error) {
	bounds := [2][3]float64{}
	for axis := 0; axis < 3; axis++ {
		bounds[0][axis] = math.Inf(1)
		bounds[1][axis] = math.Inf(-1)
	}
	err := scanFloat32Groups(path, 3, cancelled, func(values []float64) error {
		for axis := 0; axis < 3; axis++ {
			value := values[axis]
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return errors.New("VTU contains non-finite point coordinates")
			}
			if value < bounds[0][axis] {
				bounds[0][axis] = value
			}
			if value > bounds[1][axis] {
				bounds[1][axis] = value
			}
		}
		return nil
	})
	if err != nil {
		return [2][3]float64{}, err
	}
	return bounds, nil
}

func streamedFloatRange(path string, components int, cancelled func() bool) ([2]float64, error) {
	result := [2]float64{math.Inf(1), math.Inf(-1)}
	err := scanFloat32Groups(path, components, cancelled, func(values []float64) error {
		value := 0.0
		for component := 0; component < components; component++ {
			item := values[component]
			if components > 1 {
				value += item * item
			} else {
				value = item
			}
		}
		if components > 1 {
			value = math.Sqrt(value)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil
		}
		if value < result[0] {
			result[0] = value
		}
		if value > result[1] {
			result[1] = value
		}
		return nil
	})
	if err != nil {
		return [2]float64{}, err
	}
	if math.IsInf(result[0], 0) {
		return [2]float64{0, 0}, nil
	}
	return result, nil
}

func scanFloat32Groups(path string, components int, cancelled func() bool, visit func([]float64) error) error {
	if components <= 0 {
		return errors.New("invalid float group dimension")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	groupBytes := components * 4
	buffer := make([]byte, streamBufferBytes+groupBytes)
	values := make([]float64, components)
	carried := 0
	for {
		if cancelled != nil && cancelled() {
			return ErrCancelled
		}
		n, readErr := file.Read(buffer[carried : streamBufferBytes+carried])
		total := carried + n
		usable := total / groupBytes * groupBytes
		for offset := 0; offset < usable; offset += groupBytes {
			for component := 0; component < components; component++ {
				values[component] = float64(math.Float32frombits(binary.LittleEndian.Uint32(buffer[offset+component*4:])))
			}
			if err := visit(values); err != nil {
				return err
			}
		}
		carried = total - usable
		copy(buffer[:carried], buffer[usable:total])
		if errors.Is(readErr, io.EOF) {
			if carried != 0 {
				return errors.New("float array is not aligned to its component dimension")
			}
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}
