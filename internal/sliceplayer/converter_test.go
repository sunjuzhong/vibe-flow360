package sliceplayer

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVTKBase64DecoderStreamsAcrossArbitraryChunkBoundaries(t *testing.T) {
	payload := bytes.Repeat([]byte{0x03, 0x7f, 0xa2, 0xff}, 40_000)
	header := make([]byte, 8)
	binary.LittleEndian.PutUint64(header, uint64(len(payload)))
	encoded := []byte(base64.StdEncoding.EncodeToString(header) + base64.StdEncoding.EncodeToString(payload))
	var output bytes.Buffer
	decoder := vtkBase64Decoder{headerBytes: 8, output: &output}
	for start := 0; start < len(encoded); {
		end := start + 7
		if end > len(encoded) {
			end = len(encoded)
		}
		if err := decoder.WriteEncoded(encoded[start:end]); err != nil {
			t.Fatal(err)
		}
		start = end
	}
	if written, err := decoder.Finish(); err != nil || written != int64(len(payload)) || !bytes.Equal(output.Bytes(), payload) {
		t.Fatalf("streamed decoder mismatch: bytes=%d err=%v", written, err)
	}
}

func vtkBinary(values []byte) string {
	header := make([]byte, 8)
	binary.LittleEndian.PutUint64(header, uint64(len(values)))
	return base64.StdEncoding.EncodeToString(header) + base64.StdEncoding.EncodeToString(values)
}

func uint32Bytes(values ...uint32) []byte {
	result := make([]byte, len(values)*4)
	for i, value := range values {
		binary.LittleEndian.PutUint32(result[i*4:], value)
	}
	return result
}

func float32Bytes(values ...float32) []byte {
	result := make([]byte, len(values)*4)
	for i, value := range values {
		binary.LittleEndian.PutUint32(result[i*4:], math.Float32bits(value))
	}
	return result
}

func testVTU() string {
	return `<?xml version="1.0"?><VTKFile type="UnstructuredGrid" header_type="UInt64"><UnstructuredGrid><Piece NumberOfPoints="4" NumberOfCells="1"><PointData>` +
		`<DataArray Name="Mach" NumberOfComponents="1" type="Float32" format="binary">` + vtkBinary(float32Bytes(0, 1, 2, 3)) + `</DataArray></PointData><Points>` +
		`<DataArray NumberOfComponents="3" type="Float32" format="binary">` + vtkBinary(float32Bytes(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0)) + `</DataArray></Points><Cells>` +
		`<DataArray Name="connectivity" type="UInt32" format="binary">` + vtkBinary(uint32Bytes(0, 1, 2, 3)) + `</DataArray>` +
		`<DataArray Name="offsets" type="UInt32" format="binary">` + vtkBinary(uint32Bytes(4)) + `</DataArray>` +
		`<DataArray Name="types" type="UInt8" format="binary">` + vtkBinary([]byte{9}) + `</DataArray>` +
		`</Cells></Piece></UnstructuredGrid></VTKFile>`
}

type vtkTestArray struct {
	name       string
	dataType   string
	components int
	section    string
	payload    []byte
}

func testVTUArrays() []vtkTestArray {
	return []vtkTestArray{
		{name: "Mach", dataType: "Float32", components: 1, section: "PointData", payload: float32Bytes(0, 1, 2, 3)},
		{dataType: "Float32", components: 3, section: "Points", payload: float32Bytes(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0)},
		{name: "connectivity", dataType: "UInt32", components: 1, section: "Cells", payload: uint32Bytes(0, 1, 2, 3)},
		{name: "offsets", dataType: "UInt32", components: 1, section: "Cells", payload: uint32Bytes(4)},
		{name: "types", dataType: "UInt8", components: 1, section: "Cells", payload: []byte{9}},
	}
}

func vtkCompressed(values []byte) []byte {
	var compressed bytes.Buffer
	writer := zlib.NewWriter(&compressed)
	_, _ = writer.Write(values)
	_ = writer.Close()
	header := make([]byte, 32)
	binary.LittleEndian.PutUint64(header[0:], 1)
	binary.LittleEndian.PutUint64(header[8:], uint64(len(values)))
	binary.LittleEndian.PutUint64(header[16:], uint64(len(values)))
	binary.LittleEndian.PutUint64(header[24:], uint64(compressed.Len()))
	return append(header, compressed.Bytes()...)
}

func testVariantVTU(appended, encoded, compressed bool) string {
	arrays := testVTUArrays()
	compressor := ""
	if compressed {
		compressor = ` compressor="vtkZLibDataCompressor"`
	}
	sections := map[string][]string{"PointData": {}, "Points": {}, "Cells": {}}
	var payload bytes.Buffer
	for _, array := range arrays {
		block := append([]byte(nil), array.payload...)
		if compressed {
			block = vtkCompressed(block)
		} else {
			header := make([]byte, 8)
			binary.LittleEndian.PutUint64(header, uint64(len(block)))
			block = append(header, block...)
		}
		attributes := fmt.Sprintf(` Name="%s" type="%s" NumberOfComponents="%d"`, array.name, array.dataType, array.components)
		if appended {
			offset := payload.Len()
			if encoded {
				encodedBlock := base64.StdEncoding.EncodeToString(block)
				payload.WriteString(encodedBlock)
			} else {
				payload.Write(block)
			}
			sections[array.section] = append(sections[array.section], fmt.Sprintf(`<DataArray%s format="appended" offset="%d"/>`, attributes, offset))
		} else {
			sections[array.section] = append(sections[array.section], `<DataArray`+attributes+` format="binary">`+base64.StdEncoding.EncodeToString(block)+`</DataArray>`)
		}
	}
	body := fmt.Sprintf(`<?xml version="1.0"?><VTKFile type="UnstructuredGrid" byte_order="LittleEndian" header_type="UInt64"%s><UnstructuredGrid><Piece NumberOfPoints="4" NumberOfCells="1"><PointData>%s</PointData><Points>%s</Points><Cells>%s</Cells></Piece></UnstructuredGrid>`, compressor, strings.Join(sections["PointData"], ""), strings.Join(sections["Points"], ""), strings.Join(sections["Cells"], ""))
	if appended {
		encoding := "raw"
		if encoded {
			encoding = "base64"
		}
		body += `<AppendedData encoding="` + encoding + `">_` + payload.String() + `</AppendedData>`
	}
	return body + `</VTKFile>`
}

func TestConvertTarGzSupportsVTKBinaryVariants(t *testing.T) {
	tests := []struct {
		name       string
		appended   bool
		encoded    bool
		compressed bool
	}{
		{name: "raw appended", appended: true},
		{name: "base64 appended", appended: true, encoded: true},
		{name: "zlib inline", encoded: true, compressed: true},
		{name: "zlib appended raw", appended: true, compressed: true},
		{name: "zlib appended base64", appended: true, encoded: true, compressed: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			archive := writeArchive(t, []archiveEntry{{name: "slice_Wake_100.vtu", body: testVariantVTU(test.appended, test.encoded, test.compressed)}})
			playback, err := ConvertTarGz(archive, t.TempDir(), 1<<20, nil)
			if err != nil {
				t.Fatal(err)
			}
			if playback.FrameCount != 1 || playback.Frames[0].Vertices != 4 || playback.Frames[0].Triangles != 2 || strings.Join(playback.Fields, ",") != "Mach" {
				t.Fatalf("unexpected playback: %#v", playback)
			}
		})
	}
}

func TestDecodeVTKBlockRejectsMalformedCompressedHeaderAndCancellation(t *testing.T) {
	bad := make([]byte, 32)
	binary.LittleEndian.PutUint64(bad, uint64(MaxDecodedArrayBytes)+1)
	if _, err := decodeVTKBlock(bytes.NewReader(bad), 8, true, filepath.Join(t.TempDir(), "bad.bin"), nil); err == nil {
		t.Fatal("oversized compressed block count was accepted")
	}
	block := vtkCompressed(bytes.Repeat([]byte{1}, 1024))
	if _, err := decodeVTKBlock(bytes.NewReader(block), 8, true, filepath.Join(t.TempDir(), "cancel.bin"), func() bool { return true }); !errors.Is(err, ErrCancelled) {
		t.Fatalf("unexpected cancellation error: %v", err)
	}
}

func testLargeVTU(triangles int) string {
	connectivity := make([]uint32, 0, triangles*3)
	offsets := make([]uint32, triangles)
	types := make([]byte, triangles)
	for index := 0; index < triangles; index++ {
		connectivity = append(connectivity, 0, 1, 2)
		offsets[index] = uint32((index + 1) * 3)
		types[index] = 5
	}
	return fmt.Sprintf(`<?xml version="1.0"?><VTKFile type="UnstructuredGrid" header_type="UInt64"><UnstructuredGrid><Piece NumberOfPoints="4" NumberOfCells="%d"><PointData>`, triangles) +
		`<DataArray Name="Mach" NumberOfComponents="1" type="Float32" format="binary">` + vtkBinary(float32Bytes(0, 1, 2, 3)) + `</DataArray></PointData><Points>` +
		`<DataArray NumberOfComponents="3" type="Float32" format="binary">` + vtkBinary(float32Bytes(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0)) + `</DataArray></Points><Cells>` +
		`<DataArray Name="connectivity" type="UInt32" format="binary">` + vtkBinary(uint32Bytes(connectivity...)) + `</DataArray>` +
		`<DataArray Name="offsets" type="UInt32" format="binary">` + vtkBinary(uint32Bytes(offsets...)) + `</DataArray>` +
		`<DataArray Name="types" type="UInt8" format="binary">` + vtkBinary(types) + `</DataArray></Cells></Piece></UnstructuredGrid></VTKFile>`
}

func TestConvertTarGzBuildsPlayableUVFFrame(t *testing.T) {
	archive := writeArchive(t, []archiveEntry{{name: "slice_Wake_000100_proc0.vtu", body: testVTU()}})
	output := filepath.Join(t.TempDir(), "assets")
	playback, err := ConvertTarGz(archive, output, 1<<20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !playback.Ready || playback.FrameCount != 1 || playback.Frames[0].Triangles != 2 || playback.Frames[0].Vertices != 4 {
		t.Fatalf("unexpected playback: %#v", playback)
	}
	if strings.Join(playback.Fields, ",") != "Mach" {
		t.Fatalf("unexpected fields: %#v", playback.Fields)
	}
	manifest, err := os.ReadFile(filepath.Join(output, filepath.FromSlash(playback.Frames[0].ManifestPath)))
	if err != nil {
		t.Fatal(err)
	}
	var entries []map[string]any
	if json.Unmarshal(manifest, &entries) != nil || len(entries) != 2 {
		t.Fatalf("invalid manifest: %s", manifest)
	}
	buffer, err := os.Stat(filepath.Join(output, "slice_Wake_000100", "piece-0000.bin"))
	if err != nil || buffer.Size() != 16 {
		t.Fatalf("unexpected buffer: %#v %v", buffer, err)
	}
	if playback.TopologyCount != 1 || playback.TopologyBytes != 72 || playback.FieldBytes != 16 || playback.CacheBytes != 88 {
		t.Fatalf("unexpected deduplicated cache stats: %#v", playback)
	}
}

func TestPrepareTarGzBuildsIndexAndPlaybackInOnePass(t *testing.T) {
	manifest := `<?xml version="1.0"?><VTKFile><PUnstructuredGrid><PPointData><PDataArray Name="Mach"/></PPointData><Piece Source="slice_Wake_000100_proc0.vtu"/></PUnstructuredGrid></VTKFile>`
	archive := writeArchive(t, []archiveEntry{
		{name: "slice_Wake_000100.pvtu", body: manifest},
		{name: "slice_Wake_000100_proc0.vtu", body: testVTU()},
	})
	lastProgress := 0
	index, playback, err := PrepareTarGz(
		archive,
		t.TempDir(),
		1<<20,
		Limits{},
		func(percent int, _ int64) bool { lastProgress = percent; return true },
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if index.EntryCount != 2 || len(index.Entries) != 2 || len(index.Slices) != 1 {
		t.Fatalf("unexpected single-pass index: %#v", index)
	}
	if strings.Join(index.Slices[0].Fields, ",") != "Mach" {
		t.Fatalf("parallel fields were not indexed: %#v", index.Slices[0])
	}
	if !playback.Ready || playback.FrameCount != 1 || lastProgress != 100 {
		t.Fatalf("unexpected playback/progress: %#v progress=%d", playback, lastProgress)
	}
}

func TestPrepareTarGzProgressivelyPublishesOnlyCompleteFrames(t *testing.T) {
	manifest := func(step string) string {
		return `<?xml version="1.0"?><VTKFile><PUnstructuredGrid><PPointData><PDataArray Name="Mach"/></PPointData><Piece Source="slice_Wake_` + step + `_proc0.vtu"/></PUnstructuredGrid></VTKFile>`
	}
	archive := writeArchive(t, []archiveEntry{
		{name: "slice_Wake_000100.pvtu", body: manifest("000100")},
		{name: "slice_Wake_000100_proc0.vtu", body: testVTU()},
		{name: "slice_Wake_000200.pvtu", body: manifest("000200")},
		{name: "slice_Wake_000200_proc0.vtu", body: testVTU()},
	})
	output := t.TempDir()
	var snapshots []Playback
	index, final, err := PrepareTarGzProgressive(
		archive, output, 2<<20, Limits{}, nil, nil,
		func(partialIndex Index, partial Playback) error {
			if !partial.Ready || partial.FrameCount == 0 {
				t.Fatalf("published unusable playback: %#v", partial)
			}
			for _, frame := range partial.Frames {
				if _, statErr := os.Stat(filepath.Join(output, frame.ManifestPath)); statErr != nil {
					t.Fatalf("published frame manifest is unavailable: %v", statErr)
				}
			}
			if partialIndex.EntryCount < partial.FrameCount*2 {
				t.Fatalf("partial index trails published frames: %#v", partialIndex)
			}
			snapshots = append(snapshots, partial)
			return nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 2 || snapshots[0].FrameCount != 1 || snapshots[1].FrameCount != 2 {
		t.Fatalf("unexpected progressive snapshots: %#v", snapshots)
	}
	if snapshots[0].Frames[0].Step == nil || *snapshots[0].Frames[0].Step != 100 {
		t.Fatalf("first complete frame was not published first: %#v", snapshots[0].Frames)
	}
	if final.FrameCount != 2 || index.EntryCount != 4 {
		t.Fatalf("unexpected final result: index=%#v playback=%#v", index, final)
	}
	if final.Frames[0].ManifestPath != snapshots[1].Frames[0].ManifestPath || final.Frames[1].ManifestPath != snapshots[1].Frames[1].ManifestPath {
		t.Fatalf("progressive and final ordering diverged: partial=%#v final=%#v", snapshots[1].Frames, final.Frames)
	}
}

func TestPrepareTarGzProgressivelyPublishesWhenPVTUFollowsPieces(t *testing.T) {
	manifest := `<?xml version="1.0"?><VTKFile><PUnstructuredGrid><Piece Source="slice_Wake_000100_proc0.vtu"/></PUnstructuredGrid></VTKFile>`
	archive := writeArchive(t, []archiveEntry{
		{name: "slice_Wake_000100_proc0.vtu", body: testVTU()},
		{name: "slice_Wake_000100.pvtu", body: manifest},
	})
	var snapshots []Playback
	_, final, err := PrepareTarGzProgressive(
		archive, t.TempDir(), 1<<20, Limits{}, nil, nil,
		func(_ Index, partial Playback) error {
			snapshots = append(snapshots, partial)
			return nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 || snapshots[0].FrameCount != 1 || final.FrameCount != 1 {
		t.Fatalf("late PVTU did not publish its completed frame: partial=%#v final=%#v", snapshots, final)
	}
}

func TestPrepareTarGzRejectsIncompleteDeclaredFrame(t *testing.T) {
	manifest := `<?xml version="1.0"?><VTKFile><PUnstructuredGrid><Piece Source="piece-a.vtu"/><Piece Source="piece-b.vtu"/></PUnstructuredGrid></VTKFile>`
	archive := writeArchive(t, []archiveEntry{
		{name: "slice_Wake_000100.pvtu", body: manifest},
		{name: "piece-a.vtu", body: testVTU()},
	})
	_, _, err := PrepareTarGzProgressive(archive, t.TempDir(), 1<<20, Limits{}, nil, nil, func(Index, Playback) error {
		t.Fatal("an incomplete frame must not be published")
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "missing VTU pieces") {
		t.Fatalf("unexpected incomplete-frame error: %v", err)
	}
}

func TestConvertTarGzDeduplicatesStaticTopologyAcrossTimeSteps(t *testing.T) {
	archive := writeArchive(t, []archiveEntry{
		{name: "slice_Wake_000100_proc0.vtu", body: testVTU()},
		{name: "slice_Wake_000200_proc0.vtu", body: testVTU()},
	})
	output := t.TempDir()
	playback, err := ConvertTarGz(archive, output, 1<<20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if playback.FrameCount != 2 || playback.TopologyCount != 1 || playback.TopologyBytes != 72 || playback.FieldBytes != 32 || playback.CacheBytes != 104 {
		t.Fatalf("static topology was not deduplicated: %#v", playback)
	}
	if playback.Frames[0].Step == nil || *playback.Frames[0].Step != 100 || playback.Frames[1].Step == nil || *playback.Frames[1].Step != 200 {
		t.Fatalf("global steps were not ordered: %#v", playback.Frames)
	}
	topologies, err := filepath.Glob(filepath.Join(output, "topology-*.bin"))
	if err != nil || len(topologies) != 1 {
		t.Fatalf("unexpected topology assets: %#v %v", topologies, err)
	}
}

func TestConvertTarGzEnforcesDeduplicatedCacheLimit(t *testing.T) {
	archive := writeArchive(t, []archiveEntry{{name: "slice_Wake_1.vtu", body: testVTU()}})
	if _, err := ConvertTarGz(archive, t.TempDir(), 87, nil); err == nil || !strings.Contains(err.Error(), "cache exceeds") {
		t.Fatalf("unexpected cache limit error: %v", err)
	}
}

func TestConvertTarGzBuildsCompactPreviewForLargeFrames(t *testing.T) {
	archive := writeArchive(t, []archiveEntry{{name: "slice_Wake_1.vtu", body: testLargeVTU(50_001)}})
	output := t.TempDir()
	playback, err := ConvertTarGz(archive, output, 10<<20, nil)
	if err != nil {
		t.Fatal(err)
	}
	frame := playback.Frames[0]
	if frame.PreviewManifestPath == "" || frame.PreviewManifestPath == frame.ManifestPath || frame.PreviewTriangles >= frame.Triangles || frame.PreviewTriangles > maxPreviewTriangles {
		t.Fatalf("preview was not compacted: %#v", frame)
	}
	if frame.PreviewVertices > frame.Vertices {
		t.Fatalf("preview added vertices: %#v", frame)
	}
	if _, err := os.Stat(filepath.Join(output, frame.PreviewManifestPath)); err != nil {
		t.Fatal(err)
	}
}

func TestConvertTarGzGroupsProcessorPiecesIntoOneFrame(t *testing.T) {
	archive := writeArchive(t, []archiveEntry{{name: "slice_Wake_42_proc0.vtu", body: testVTU()}, {name: "slice_Wake_42_proc1.vtu", body: testVTU()}})
	playback, err := ConvertTarGz(archive, t.TempDir(), 1<<20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if playback.FrameCount != 1 || playback.Frames[0].Vertices != 8 || playback.Frames[0].Triangles != 4 {
		t.Fatalf("processor pieces were not grouped: %#v", playback)
	}
	if playback.Frames[0].Slice != "slice_Wake" || strings.Join(playback.Frames[0].Fields, ",") != "Mach" {
		t.Fatalf("frame identity or fields were not preserved: %#v", playback.Frames[0])
	}
	if bounds := playback.Frames[0].FieldRanges["Mach"]; bounds != [2]float64{0, 3} {
		t.Fatalf("frame field range was not aggregated across processor pieces: %#v", bounds)
	}
}

func TestConvertTarGzPreservesMultipleNamedSliceTracks(t *testing.T) {
	archive := writeArchive(t, []archiveEntry{
		{name: "slice_Wake_100.vtu", body: testVTU()},
		{name: "slice_Wake_200.vtu", body: testVTU()},
		{name: "slice_Centerline_100.vtu", body: testVTU()},
		{name: "slice_Centerline_200.vtu", body: testVTU()},
	})
	playback, err := ConvertTarGz(archive, t.TempDir(), 1<<20, nil)
	if err != nil {
		t.Fatal(err)
	}
	tracks := map[string][]int64{}
	for _, frame := range playback.Frames {
		if frame.Step == nil {
			t.Fatalf("frame has no step: %#v", frame)
		}
		tracks[frame.Slice] = append(tracks[frame.Slice], *frame.Step)
	}
	if fmt.Sprint(tracks["slice_Wake"]) != "[100 200]" || fmt.Sprint(tracks["slice_Centerline"]) != "[100 200]" {
		t.Fatalf("named slice tracks were flattened: %#v", tracks)
	}
}

func TestConvertTarGzUsesPVTUPieceReferencesForFrameGrouping(t *testing.T) {
	manifest := `<?xml version="1.0"?><VTKFile><PUnstructuredGrid><Piece Source="unexpected-a.vtu"/><Piece Source="unexpected-b.vtu"/></PUnstructuredGrid></VTKFile>`
	archive := writeArchive(t, []archiveEntry{
		{name: "nested/slice_Wake_000123.pvtu", body: manifest},
		{name: "nested/unexpected-a.vtu", body: testVTU()},
		{name: "nested/unexpected-b.vtu", body: testVTU()},
	})
	playback, err := ConvertTarGz(archive, t.TempDir(), 1<<20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if playback.FrameCount != 1 || playback.Frames[0].Step == nil || *playback.Frames[0].Step != 123 || playback.Frames[0].Vertices != 8 {
		t.Fatalf("PVTU pieces were not grouped by their manifest: %#v", playback)
	}
}
