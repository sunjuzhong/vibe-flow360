package sliceplayer

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

func TestRealArchiveWhenConfigured(t *testing.T) {
	archive := os.Getenv("VIBESIM_REAL_SLICE_ARCHIVE")
	if archive == "" {
		t.Skip("real archive not configured")
	}
	var baseline runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&baseline)
	var peakHeap atomic.Uint64
	peakHeap.Store(baseline.HeapInuse)
	stopSampling := make(chan struct{})
	doneSampling := make(chan struct{})
	go func() {
		defer close(doneSampling)
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				var stats runtime.MemStats
				runtime.ReadMemStats(&stats)
				for previous := peakHeap.Load(); stats.HeapInuse > previous && !peakHeap.CompareAndSwap(previous, stats.HeapInuse); previous = peakHeap.Load() {
				}
			case <-stopSampling:
				return
			}
		}
	}()
	startedAt := time.Now()
	playback, err := ConvertTarGz(archive, t.TempDir(), 2<<30, nil)
	close(stopSampling)
	<-doneSampling
	elapsed := time.Since(startedAt)
	if err != nil {
		t.Fatal(err)
	}
	if !playback.Ready || playback.FrameCount < 2 || playback.Frames[0].Triangles == 0 {
		t.Fatalf("unexpected playback: %#v", playback)
	}
	stepCount := 0
	firstStep, lastStep := int64(0), int64(0)
	previewFrames := 0
	for _, candidate := range playback.Frames {
		if candidate.Step != nil {
			if stepCount > 0 && *candidate.Step < lastStep {
				t.Fatalf("steps are not sorted: %d after %d", *candidate.Step, lastStep)
			}
			if stepCount == 0 {
				firstStep = *candidate.Step
			}
			lastStep = *candidate.Step
			stepCount++
		}
		if candidate.PreviewManifestPath != "" && candidate.PreviewTriangles < candidate.Triangles {
			previewFrames++
		}
		for field, frameRange := range candidate.FieldRanges {
			globalRange, ok := playback.FieldRanges[field]
			if !ok || globalRange[0] > frameRange[0] || globalRange[1] < frameRange[1] {
				t.Fatalf("global range does not cover frame range for %s: global=%v frame=%v", field, globalRange, frameRange)
			}
		}
	}
	if stepCount < 2 || firstStep >= lastStep {
		t.Fatalf("archive is not genuinely unsteady: steps=%d range=%d..%d", stepCount, firstStep, lastStep)
	}
	if previewFrames == 0 {
		t.Fatal("real archive did not exercise Preview/Full switching")
	}
	frame := playback.Frames[0]
	if frame.Triangles > maxPreviewTriangles && (frame.PreviewManifestPath == "" || frame.PreviewTriangles > maxPreviewTriangles) {
		t.Fatalf("large frame has no bounded preview: %#v", frame)
	}
	peakBytes := peakHeap.Load()
	peakDelta := uint64(0)
	if peakBytes > baseline.HeapInuse {
		peakDelta = peakBytes - baseline.HeapInuse
	}
	t.Logf("REAL_SLICE_VALIDATION frames=%d steps=%d..%d preview_frames=%d fields=%v topology_count=%d topology=%dB fields=%dB cache=%dB peak_heap=%dB peak_heap_delta=%dB elapsed=%s", playback.FrameCount, firstStep, lastStep, previewFrames, playback.Fields, playback.TopologyCount, playback.TopologyBytes, playback.FieldBytes, playback.CacheBytes, peakBytes, peakDelta, elapsed.Round(time.Millisecond))
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
