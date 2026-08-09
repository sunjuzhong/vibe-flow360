package sliceplayer

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const maxPreviewTriangles = 50_000

func buildPreviewPiece(outputDir, frameDir, assetKey string, pieceIndex int, full convertedPiece, cancelled func() bool) (convertedPiece, bool, string, int64, int64, error) {
	if full.Triangles <= maxPreviewTriangles {
		return full, false, "", 0, 0, nil
	}
	if len(full.Sections) < 2 {
		return convertedPiece{}, false, "", 0, 0, errors.New("full frame has no topology sections")
	}
	indexSection, positionSection := full.Sections[0], full.Sections[1]
	indexPath := indexSection.Path
	if indexPath == "" {
		indexPath = full.Buffer
	}
	positionPath := positionSection.Path
	if positionPath == "" {
		positionPath = full.Buffer
	}
	stride := (full.Triangles + maxPreviewTriangles - 1) / maxPreviewTriangles
	oldToNew := make(map[uint32]uint32, maxPreviewTriangles*2)
	oldIDs := make([]uint32, 0, maxPreviewTriangles*2)
	previewIndices := make([]uint32, 0, maxPreviewTriangles*3)
	triangleIndex := 0
	err := scanFixedSection(filepath.Join(outputDir, filepath.FromSlash(indexPath)), indexSection.Offset, indexSection.Length, 12, cancelled, func(group []byte) error {
		if triangleIndex%stride == 0 {
			for offset := 0; offset < 12; offset += 4 {
				oldID := binary.LittleEndian.Uint32(group[offset:])
				if uint64(oldID) >= uint64(full.Vertices) {
					return errors.New("preview topology references a missing vertex")
				}
				newID, exists := oldToNew[oldID]
				if !exists {
					newID = uint32(len(oldIDs))
					oldToNew[oldID] = newID
					oldIDs = append(oldIDs, oldID)
				}
				previewIndices = append(previewIndices, newID)
			}
		}
		triangleIndex++
		return nil
	})
	if err != nil {
		return convertedPiece{}, false, "", 0, 0, err
	}
	if len(previewIndices) == 0 || len(oldIDs) == 0 {
		return convertedPiece{}, false, "", 0, 0, errors.New("preview sampling produced no geometry")
	}
	positions := make([]byte, len(oldIDs)*12)
	pointIndex := uint32(0)
	err = scanFixedSection(filepath.Join(outputDir, filepath.FromSlash(positionPath)), positionSection.Offset, positionSection.Length, 12, cancelled, func(group []byte) error {
		if newID, wanted := oldToNew[pointIndex]; wanted {
			copy(positions[int(newID)*12:], group)
		}
		pointIndex++
		return nil
	})
	if err != nil {
		return convertedPiece{}, false, "", 0, 0, err
	}
	combinedPath := filepath.Join(frameDir, fmt.Sprintf("preview-piece-%04d.bin", pieceIndex))
	output, err := os.OpenFile(combinedPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return convertedPiece{}, false, "", 0, 0, err
	}
	indicesBytes := make([]byte, len(previewIndices)*4)
	for index, value := range previewIndices {
		binary.LittleEndian.PutUint32(indicesBytes[index*4:], value)
	}
	if _, err = output.Write(indicesBytes); err == nil {
		_, err = output.Write(positions)
	}
	sections := []uvfSection{
		{Name: "indices", DType: "uint32", Dimension: 1, Offset: 0, Length: int64(len(indicesBytes))},
		{Name: "position", DType: "float32", Dimension: 3, Offset: int64(len(indicesBytes)), Length: int64(len(positions))},
	}
	offset := int64(len(indicesBytes) + len(positions))
	for _, field := range full.Sections[2:] {
		if err != nil {
			break
		}
		groupBytes := field.Dimension * 4
		values := make([]byte, len(oldIDs)*groupBytes)
		vertexIndex := uint32(0)
		fieldPath := field.Path
		if fieldPath == "" {
			fieldPath = full.Buffer
		}
		err = scanFixedSection(filepath.Join(outputDir, filepath.FromSlash(fieldPath)), field.Offset, field.Length, groupBytes, cancelled, func(group []byte) error {
			if newID, wanted := oldToNew[vertexIndex]; wanted {
				copy(values[int(newID)*groupBytes:], group)
			}
			vertexIndex++
			return nil
		})
		if err == nil {
			_, err = output.Write(values)
		}
		if err == nil {
			sections = append(sections, uvfSection{Name: field.Name, DType: field.DType, Dimension: field.Dimension, Offset: offset, Length: int64(len(values))})
			offset += int64(len(values))
		}
	}
	closeErr := output.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(combinedPath)
		return convertedPiece{}, false, "", 0, 0, err
	}
	preview := convertedPiece{Buffer: filepath.ToSlash(filepath.Join(assetKey, filepath.Base(combinedPath))), Sections: sections, Bounds: full.Bounds, Fields: full.Fields, Vertices: len(oldIDs), Triangles: len(previewIndices) / 3}
	_, topologyName, topologyBytes, fieldBytes, err := splitTopologyBuffer(outputDir, combinedPath, &preview)
	if err != nil {
		return convertedPiece{}, false, "", 0, 0, err
	}
	return preview, true, topologyName, topologyBytes, fieldBytes, nil
}

func scanFixedSection(path string, offset, length int64, groupBytes int, cancelled func() bool, visit func([]byte) error) error {
	if offset < 0 || length < 0 || groupBytes <= 0 || length%int64(groupBytes) != 0 {
		return errors.New("invalid fixed-width buffer section")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err = file.Seek(offset, io.SeekStart); err != nil {
		return err
	}
	reader := io.LimitReader(file, length)
	buffer := make([]byte, streamBufferBytes+groupBytes)
	carried := 0
	for {
		if cancelled != nil && cancelled() {
			return ErrCancelled
		}
		n, readErr := reader.Read(buffer[carried : streamBufferBytes+carried])
		total := carried + n
		usable := total / groupBytes * groupBytes
		for position := 0; position < usable; position += groupBytes {
			if err := visit(buffer[position : position+groupBytes]); err != nil {
				return err
			}
		}
		carried = total - usable
		copy(buffer[:carried], buffer[usable:total])
		if errors.Is(readErr, io.EOF) {
			if carried != 0 {
				return errors.New("buffer section ended mid-value")
			}
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}
