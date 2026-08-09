package sliceplayer

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type archiveEntry struct {
	name, body string
	typeflag   byte
	linkname   string
}

func writeArchive(t *testing.T, entries []archiveEntry) string {
	t.Helper()
	filename := filepath.Join(t.TempDir(), "slices.tar.gz")
	file, err := os.Create(filename)
	if err != nil {
		t.Fatal(err)
	}
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	for _, entry := range entries {
		typeflag := entry.typeflag
		if typeflag == 0 {
			typeflag = tar.TypeReg
		}
		header := &tar.Header{Name: entry.name, Mode: 0o600, Size: int64(len(entry.body)), Typeflag: typeflag, Linkname: entry.linkname}
		if err := tarWriter.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if typeflag == tar.TypeReg {
			if _, err := tarWriter.Write([]byte(entry.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return filename
}

func TestScanTarGzBuildsSliceAndFrameIndex(t *testing.T) {
	filename := writeArchive(t, []archiveEntry{
		{name: "slice_wake/slice_wake_000100.vtu", body: "first"},
		{name: "slice_wake/slice_wake_000200.vtu", body: "second"},
		{name: "slice_midspan/slice_midspan_000100.vtp", body: "third"},
	})
	var lastProgress int
	index, err := ScanTarGz(filename, Limits{}, func(percent int, _ int64) bool { lastProgress = percent; return true })
	if err != nil {
		t.Fatal(err)
	}
	if index.EntryCount != 3 || len(index.Entries) != 3 {
		t.Fatalf("unexpected entries: %#v", index)
	}
	if len(index.Slices) != 2 {
		t.Fatalf("unexpected slices: %#v", index.Slices)
	}
	wake := index.Slices[1]
	if wake.Name != "slice_wake" || wake.FrameCount != 2 || wake.FirstStep == nil || *wake.FirstStep != 100 || wake.LastStep == nil || *wake.LastStep != 200 {
		t.Fatalf("unexpected wake summary: %#v", wake)
	}
	if strings.Join(index.Formats, ",") != "vtp,vtu" {
		t.Fatalf("unexpected formats: %#v", index.Formats)
	}
	if lastProgress != 100 {
		t.Fatalf("progress ended at %d", lastProgress)
	}
}

func TestScanTarGzRejectsUnsafeAndOversizedEntries(t *testing.T) {
	unsafe := writeArchive(t, []archiveEntry{{name: "../escape.vtu", body: "bad"}})
	if _, err := ScanTarGz(unsafe, Limits{}, nil); err == nil || !strings.Contains(err.Error(), "unsafe path") {
		t.Fatalf("unexpected unsafe path error: %v", err)
	}

	large := writeArchive(t, []archiveEntry{{name: "slice_wake_1.vtu", body: "12345"}})
	if _, err := ScanTarGz(large, Limits{MaxEntryBytes: 4}, nil); err == nil || !strings.Contains(err.Error(), "exceeds 4 bytes") {
		t.Fatalf("unexpected size error: %v", err)
	}
}

func TestScanTarGzRejectsLinks(t *testing.T) {
	filename := writeArchive(t, []archiveEntry{{name: "slice_wake/link", typeflag: tar.TypeSymlink, linkname: "/tmp/target"}})
	if _, err := ScanTarGz(filename, Limits{}, nil); err == nil || !strings.Contains(err.Error(), "unsupported link") {
		t.Fatalf("unexpected link error: %v", err)
	}
}

func TestScanTarGzGroupsParallelVTKPiecesAndReadsFields(t *testing.T) {
	manifest := `<?xml version="1.0"?><VTKFile><PUnstructuredGrid><PPointData><PDataArray Name="vorticity"/><PDataArray Name="Mach"/></PPointData><Piece Source="slice_Wake_proc0.vtu"/></PUnstructuredGrid></VTKFile>`
	filename := writeArchive(t, []archiveEntry{
		{name: "slice_Wake.pvtu", body: manifest},
		{name: "slice_Wake_proc0.vtu", body: "piece"},
	})
	index, err := ScanTarGz(filename, Limits{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(index.Slices) != 1 {
		t.Fatalf("parallel pieces were split into different slices: %#v", index.Slices)
	}
	slice := index.Slices[0]
	if slice.Name != "slice_Wake" || slice.FrameCount != 1 {
		t.Fatalf("unexpected slice summary: %#v", slice)
	}
	if strings.Join(slice.Fields, ",") != "Mach,vorticity" {
		t.Fatalf("unexpected field catalog: %#v", slice.Fields)
	}
}
