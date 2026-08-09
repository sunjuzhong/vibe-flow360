package sliceplayer

import (
	"os"
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
