package sliceplayer

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestRealArchiveWhenConfigured(t *testing.T) {
	archive := os.Getenv("VIBESIM_REAL_SLICE_ARCHIVE")
	if archive == "" {
		t.Skip("real archive not configured")
	}
	playback, err := ConvertTarGz(archive, t.TempDir(), 1<<30, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !playback.Ready || playback.FrameCount == 0 || playback.Frames[0].Triangles == 0 {
		t.Fatalf("unexpected playback: %#v", playback)
	}
	frame := playback.Frames[0]
	if frame.Triangles > maxPreviewTriangles && (frame.PreviewManifestPath == "" || frame.PreviewTriangles > maxPreviewTriangles) {
		t.Fatalf("large frame has no bounded preview: %#v", frame)
	}
	t.Logf("frames=%d full=%d vertices/%d triangles preview=%d vertices/%d triangles fields=%v topology=%dB fields=%dB cache=%dB", playback.FrameCount, frame.Vertices, frame.Triangles, frame.PreviewVertices, frame.PreviewTriangles, playback.Fields, playback.TopologyBytes, playback.FieldBytes, playback.CacheBytes)
}

func TestRealArchiveProgressiveFirstFrameWhenConfigured(t *testing.T) {
	archive := os.Getenv("VIBESIM_REAL_SLICE_ARCHIVE")
	if archive == "" {
		t.Skip("real archive not configured")
	}
	stopAfterFirst := errors.New("first progressive frame verified")
	output := t.TempDir()
	var first Playback
	_, _, err := PrepareTarGzProgressive(
		archive, output, 1<<30, Limits{}, nil, nil,
		func(_ Index, partial Playback) error {
			first = partial
			return stopAfterFirst
		},
	)
	if !errors.Is(err, stopAfterFirst) {
		t.Fatalf("progressive preparation did not publish a first frame: %v", err)
	}
	if !first.Ready || first.FrameCount < 1 || first.Frames[0].Triangles < 1 {
		t.Fatalf("unexpected first progressive frame: %#v", first)
	}
	if _, err := os.Stat(filepath.Join(output, first.Frames[0].ManifestPath)); err != nil {
		t.Fatalf("first progressive manifest is unavailable: %v", err)
	}
	t.Logf("first progressive snapshot: frames=%d vertices=%d triangles=%d fields=%v", first.FrameCount, first.Frames[0].Vertices, first.Frames[0].Triangles, first.Fields)
}
