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
	t.Logf("frames=%d vertices=%d triangles=%d fields=%v", playback.FrameCount, playback.Frames[0].Vertices, playback.Frames[0].Triangles, playback.Fields)
}
