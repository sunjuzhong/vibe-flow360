package sliceplayer

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
	buffer, err := os.Stat(filepath.Join(filepath.Dir(filepath.Join(output, filepath.FromSlash(playback.Frames[0].ManifestPath))), "piece-0000.bin"))
	if err != nil || buffer.Size() != 88 {
		t.Fatalf("unexpected buffer: %#v %v", buffer, err)
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
}
