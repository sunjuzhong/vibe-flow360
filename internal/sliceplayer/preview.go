package sliceplayer

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
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
	indices := make([]uint32, 0, full.Triangles*3)
	err := scanFixedSection(filepath.Join(outputDir, filepath.FromSlash(indexPath)), indexSection.Offset, indexSection.Length, 12, cancelled, func(group []byte) error {
		for offset := 0; offset < 12; offset += 4 {
			oldID := binary.LittleEndian.Uint32(group[offset:])
			if uint64(oldID) >= uint64(full.Vertices) {
				return errors.New("preview topology references a missing vertex")
			}
			indices = append(indices, oldID)
		}
		return nil
	})
	if err != nil {
		return convertedPiece{}, false, "", 0, 0, err
	}
	fullPositions := make([]float32, 0, full.Vertices*3)
	err = scanFixedSection(filepath.Join(outputDir, filepath.FromSlash(positionPath)), positionSection.Offset, positionSection.Length, 12, cancelled, func(group []byte) error {
		for offset := 0; offset < 12; offset += 4 {
			fullPositions = append(fullPositions, math.Float32frombits(binary.LittleEndian.Uint32(group[offset:])))
		}
		return nil
	})
	if err != nil {
		return convertedPiece{}, false, "", 0, 0, err
	}
	oldIDs, previewIndices, err := clusterPreviewTopology(indices, fullPositions, full.Bounds, maxPreviewTriangles, cancelled)
	if err != nil {
		return convertedPiece{}, false, "", 0, 0, err
	}
	oldToNew := make(map[uint32]uint32, len(oldIDs))
	positions := make([]byte, len(oldIDs)*12)
	for newID, oldID := range oldIDs {
		oldToNew[oldID] = uint32(newID)
		for component := 0; component < 3; component++ {
			binary.LittleEndian.PutUint32(positions[newID*12+component*4:], math.Float32bits(fullPositions[int(oldID)*3+component]))
		}
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

type previewCell struct {
	x int64
	y int64
	z int64
}

type previewTriangle struct {
	a uint32
	b uint32
	c uint32
}

// clusterPreviewTopology collapses nearby vertices and remaps every source
// triangle. Unlike triangle-stride sampling, this keeps neighboring triangles
// connected and therefore does not punch checkerboard holes into slice planes.
func clusterPreviewTopology(indices []uint32, positions []float32, bounds [2][3]float64, targetTriangles int, cancelled func() bool) ([]uint32, []uint32, error) {
	if len(indices)%3 != 0 || len(positions)%3 != 0 || targetTriangles < 1 {
		return nil, nil, errors.New("invalid preview topology")
	}
	extents := [3]float64{}
	maxExtent := 0.0
	for axis := 0; axis < 3; axis++ {
		extents[axis] = math.Max(0, bounds[1][axis]-bounds[0][axis])
		maxExtent = math.Max(maxExtent, extents[axis])
	}
	if maxExtent <= 0 {
		return nil, nil, errors.New("preview geometry has empty bounds")
	}
	dimensions := 0
	extentProduct := 1.0
	for _, extent := range extents {
		if extent > maxExtent*1e-9 {
			dimensions++
			extentProduct *= extent
		}
	}
	if dimensions == 0 {
		dimensions = 1
		extentProduct = maxExtent
	}
	targetVertices := math.Max(4, float64(targetTriangles)/2)
	cellSize := math.Pow(extentProduct/targetVertices, 1/float64(dimensions))
	if !isFinitePositive(cellSize) {
		cellSize = maxExtent / math.Pow(targetVertices, 1/float64(dimensions))
	}
	for attempt := 0; attempt < 12; attempt++ {
		if cancelled != nil && cancelled() {
			return nil, nil, ErrCancelled
		}
		cellToID := make(map[previewCell]uint32, int(targetVertices))
		oldToNew := make([]uint32, len(positions)/3)
		representatives := make([]uint32, 0, int(targetVertices))
		for vertex := range oldToNew {
			if vertex%16_384 == 0 && cancelled != nil && cancelled() {
				return nil, nil, ErrCancelled
			}
			coordinate := func(axis int) int64 {
				if extents[axis] <= maxExtent*1e-9 {
					return 0
				}
				return int64(math.Floor((float64(positions[vertex*3+axis]) - bounds[0][axis]) / cellSize))
			}
			cell := previewCell{x: coordinate(0), y: coordinate(1), z: coordinate(2)}
			newID, exists := cellToID[cell]
			if !exists {
				newID = uint32(len(representatives))
				cellToID[cell] = newID
				representatives = append(representatives, uint32(vertex))
			}
			oldToNew[vertex] = newID
		}
		previewIndices := make([]uint32, 0, min(len(indices), targetTriangles*3))
		seenTriangles := make(map[previewTriangle]struct{}, min(len(indices)/3, targetTriangles))
		for offset := 0; offset < len(indices); offset += 3 {
			a := oldToNew[indices[offset]]
			b := oldToNew[indices[offset+1]]
			c := oldToNew[indices[offset+2]]
			if a == b || b == c || a == c {
				continue
			}
			keyA, keyB, keyC := a, b, c
			if keyA > keyB {
				keyA, keyB = keyB, keyA
			}
			if keyB > keyC {
				keyB, keyC = keyC, keyB
			}
			if keyA > keyB {
				keyA, keyB = keyB, keyA
			}
			key := previewTriangle{a: keyA, b: keyB, c: keyC}
			if _, exists := seenTriangles[key]; exists {
				continue
			}
			seenTriangles[key] = struct{}{}
			previewIndices = append(previewIndices, a, b, c)
		}
		triangles := len(previewIndices) / 3
		if triangles > 0 && triangles <= targetTriangles {
			return representatives, previewIndices, nil
		}
		if triangles == 0 {
			return nil, nil, errors.New("preview clustering produced no geometry")
		}
		ratio := math.Pow(float64(triangles)/float64(targetTriangles), 1/float64(dimensions))
		cellSize *= math.Max(1.15, ratio*1.05)
	}
	return nil, nil, errors.New("preview clustering could not reach triangle budget")
}

func isFinitePositive(value float64) bool {
	return value > 0 && !math.IsInf(value, 0) && !math.IsNaN(value)
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
