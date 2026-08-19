package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/sliceplayer"
)

type slicePlayerRequest struct {
	ResultPath string `json:"result_path"`
	SizeBytes  int64  `json:"size_bytes"`
}

func (s *Server) startSlicePlayerJob(c *gin.Context) {
	caseID := c.Param("resource_id")
	if err := flow360.ValidateResourcePath("Case", caseID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.slicePlayerJobs == nil || s.flow360 == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Case time-series preparation is not configured"})
		return
	}
	var request slicePlayerRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "time-series preparation request must be valid JSON"})
		return
	}
	request.ResultPath = strings.TrimSpace(request.ResultPath)
	if !validTimeSeriesArchivePath(request.ResultPath) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "result_path must identify a supported Case time-series archive"})
		return
	}
	if request.SizeBytes < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "size_bytes cannot be negative"})
		return
	}
	maxArchiveBytes := slicePlayerMaxArchiveBytes()
	if request.SizeBytes > maxArchiveBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": fmt.Sprintf("Time-series archive exceeds the configured %d byte local preparation limit", maxArchiveBytes)})
		return
	}
	cacheKey := sliceplayer.CacheKey(caseID, request.ResultPath, request.SizeBytes)
	if request.SizeBytes == 0 {
		cacheKey += ":unknown-size:" + strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	}
	job, err := s.slicePlayerJobs.Create(caseID, request.ResultPath, request.SizeBytes, cacheKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	go s.runSlicePlayerJob(job.ID, caseID, request.ResultPath, cacheKey)
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, job)
}

func (s *Server) latestSlicePlayerJob(c *gin.Context) {
	caseID := c.Param("resource_id")
	if err := flow360.ValidateResourcePath("Case", caseID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.slicePlayerJobs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Case time-series preparation is not configured"})
		return
	}
	resultPath := strings.TrimSpace(c.Query("result_path"))
	if resultPath != "" && !validTimeSeriesArchivePath(resultPath) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "result_path must identify a supported Case time-series archive"})
		return
	}
	job, ok := s.slicePlayerJobs.LatestForResultPath(caseID, resultPath)
	if ok {
		expectedCacheKey := sliceplayer.CacheKey(job.CaseID, job.ResultPath, job.SourceSize)
		ok = strings.HasPrefix(job.CacheKey, expectedCacheKey)
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "No time-series preparation exists for this Case archive"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, job)
}

func (s *Server) getSlicePlayerJob(c *gin.Context)    { s.writeSlicePlayerJob(c, false) }
func (s *Server) cancelSlicePlayerJob(c *gin.Context) { s.writeSlicePlayerJob(c, true) }

func (s *Server) writeSlicePlayerJob(c *gin.Context, cancel bool) {
	caseID := c.Param("resource_id")
	if err := flow360.ValidateResourcePath("Case", caseID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.slicePlayerJobs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Case time-series preparation is not configured"})
		return
	}
	job, ok := s.slicePlayerJobs.Get(c.Param("job_id"))
	if !ok || job.CaseID != caseID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Case time-series preparation was not found"})
		return
	}
	if cancel {
		var err error
		job, err = s.slicePlayerJobs.Cancel(job.ID)
		if err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		s.cancelSlicePlayerWork(job.ID)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, job)
}

func (s *Server) runSlicePlayerJob(jobID, caseID, resultPath, cacheKey string) {
	metrics := sliceplayer.PreparationMetrics{}
	cacheStarted := time.Now()
	if index, ok := s.slicePlayerJobs.Cached(cacheKey); ok {
		if playback, playbackOK := s.slicePlayerJobs.CachedPlayback(cacheKey); playbackOK {
			metrics.CacheHit = true
			metrics.CacheRestoreMilliseconds = slicePlayerElapsedMilliseconds(cacheStarted)
			_, _ = s.slicePlayerJobs.Update(jobID, 98, "restoring-player-cache")
			_, _ = s.slicePlayerJobs.CompleteWithMetrics(jobID, index, playback, metrics)
			return
		}
	}
	if s.slicePlayerSlots != nil {
		s.slicePlayerSlots <- struct{}{}
		defer func() { <-s.slicePlayerSlots }()
	}
	if s.slicePlayerJobs.IsCancelled(jobID) {
		return
	}

	sourceSize := s.slicePlayerSourceSize(jobID)
	downloadDir, err := s.slicePlayerJobs.ArchiveDirectory(sliceplayer.SourceKey(caseID, resultPath, sourceSize))
	if err != nil {
		_, _ = s.slicePlayerJobs.Fail(jobID, err)
		return
	}
	_, _ = s.slicePlayerJobs.Update(jobID, 5, "downloading-archive")
	downloadStarted := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Minute)
	s.registerSlicePlayerCancel(jobID, cancel)
	defer func() {
		s.unregisterSlicePlayerCancel(jobID)
		cancel()
	}()
	archivePath, archiveReused, err := s.slicePlayerJobs.ReusableArchive(caseID, resultPath, sourceSize)
	if err == nil && !archiveReused {
		if available, spaceErr := availableDiskBytes(downloadDir); spaceErr == nil {
			if capacityErr := slicePlayerDownloadCapacityError(sourceSize, available); capacityErr != nil {
				err = capacityErr
			}
		}
	}
	if err == nil && !archiveReused {
		archivePath, err = s.flow360.DownloadCaseResultToExpected(ctx, caseID, resultPath, downloadDir, sourceSize, slicePlayerMaxArchiveBytes())
	}
	if err != nil {
		if s.slicePlayerJobs.IsCancelled(jobID) {
			return
		}
		_, _ = s.slicePlayerJobs.Fail(jobID, humanizeSlicePlayerDownloadError(err))
		return
	}
	if s.slicePlayerJobs.IsCancelled(jobID) {
		return
	}
	metrics.DownloadMilliseconds = slicePlayerElapsedMilliseconds(downloadStarted)
	_, _ = s.slicePlayerJobs.Update(jobID, 35, "preparing-frames")
	assetDirectory, err := s.slicePlayerJobs.AssetDirectory(cacheKey)
	if err != nil {
		_, _ = s.slicePlayerJobs.Fail(jobID, err)
		return
	}
	lastProgress := -1
	partialPublished := false
	prepareStarted := time.Now()
	index, playback, err := sliceplayer.PrepareTarGzProgressive(archivePath, assetDirectory, slicePlayerMaxArchiveBytes(), sliceplayer.DefaultLimits, func(percent int, _ int64) bool {
		if s.slicePlayerJobs.IsCancelled(jobID) {
			return false
		}
		if percent > lastProgress {
			lastProgress = percent
			stage := "preparing-frames"
			if partialPublished {
				stage = "preparing-remaining-frames"
			}
			_, _ = s.slicePlayerJobs.Update(jobID, 35+(percent*60/100), stage)
		}
		return true
	}, func() bool { return s.slicePlayerJobs.IsCancelled(jobID) }, func(partialIndex sliceplayer.Index, partialPlayback sliceplayer.Playback) error {
		if s.slicePlayerJobs.IsCancelled(jobID) {
			return sliceplayer.ErrCancelled
		}
		if _, publishErr := s.slicePlayerJobs.PublishPartial(jobID, partialIndex, partialPlayback); publishErr != nil {
			return publishErr
		}
		partialPublished = true
		return nil
	})
	if err != nil {
		if s.slicePlayerJobs.IsCancelled(jobID) {
			return
		}
		_, _ = s.slicePlayerJobs.Fail(jobID, err)
		return
	}
	if s.slicePlayerJobs.IsCancelled(jobID) {
		return
	}
	metrics.PrepareMilliseconds = slicePlayerElapsedMilliseconds(prepareStarted)
	_, _ = s.slicePlayerJobs.Update(jobID, 97, "persisting-player-cache")
	if _, err := s.slicePlayerJobs.CompleteWithMetrics(jobID, index, &playback, metrics); err != nil {
		_, _ = s.slicePlayerJobs.Fail(jobID, err)
	}
}

func (s *Server) slicePlayerSourceSize(jobID string) int64 {
	job, ok := s.slicePlayerJobs.Get(jobID)
	if !ok {
		return 0
	}
	return job.SourceSize
}

func (s *Server) resumeSlicePlayerJobs() {
	if s.slicePlayerJobs == nil || s.flow360 == nil {
		return
	}
	for _, job := range s.slicePlayerJobs.RecoverableJobs() {
		job := job
		go s.runSlicePlayerJob(job.ID, job.CaseID, job.ResultPath, job.CacheKey)
	}
}

func (s *Server) slicePlayerAsset(c *gin.Context) {
	caseID := c.Param("resource_id")
	job, ok := s.slicePlayerJobs.Get(c.Param("job_id"))
	partialReady := job.Report != nil && job.Report.PartialReady && job.Report.Playback != nil && job.Report.Playback.Ready
	if !ok || job.CaseID != caseID || (job.Status != sliceplayer.JobCompleted && !partialReady) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Slice player asset was not found"})
		return
	}
	release, protected := s.slicePlayerJobs.Protect(job.ID)
	if !protected {
		c.JSON(http.StatusNotFound, gin.H{"error": "Slice player asset was not found"})
		return
	}
	defer release()
	relative := strings.TrimPrefix(c.Param("asset_path"), "/")
	target, err := s.slicePlayerJobs.AssetPath(job.ID, relative)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Slice player asset was not found"})
		return
	}
	c.Header("Cache-Control", "private, max-age=31536000, immutable")
	if strings.HasSuffix(strings.ToLower(target), ".bin") {
		c.Header("Content-Type", "application/octet-stream")
	}
	c.File(target)
}

func (s *Server) registerSlicePlayerCancel(jobID string, cancel context.CancelFunc) {
	s.slicePlayerCancelMu.Lock()
	defer s.slicePlayerCancelMu.Unlock()
	if s.slicePlayerCancels == nil {
		s.slicePlayerCancels = map[string]context.CancelFunc{}
	}
	s.slicePlayerCancels[jobID] = cancel
}

func (s *Server) unregisterSlicePlayerCancel(jobID string) {
	s.slicePlayerCancelMu.Lock()
	defer s.slicePlayerCancelMu.Unlock()
	delete(s.slicePlayerCancels, jobID)
}

func (s *Server) cancelSlicePlayerWork(jobID string) {
	s.slicePlayerCancelMu.Lock()
	cancel := s.slicePlayerCancels[jobID]
	s.slicePlayerCancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func validTimeSeriesArchivePath(resultPath string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(resultPath, "\\", "/"))
	return normalized == "results/slices.tar.gz" || normalized == "results/surfaces.tar.gz"
}

func slicePlayerMaxArchiveBytes() int64 {
	const defaultLimit = int64(100 << 30)
	configured := strings.TrimSpace(os.Getenv("VIBESIM_SLICE_PLAYER_MAX_ARCHIVE_BYTES"))
	if configured == "" {
		return defaultLimit
	}
	value, err := strconv.ParseInt(configured, 10, 64)
	if err != nil || value <= 0 {
		return defaultLimit
	}
	return value
}

func slicePlayerCacheMaxBytes() int64 {
	const defaultLimit = int64(250 << 30)
	configured := strings.TrimSpace(os.Getenv("VIBESIM_SLICE_PLAYER_CACHE_MAX_BYTES"))
	if configured == "" {
		return defaultLimit
	}
	value, err := strconv.ParseInt(configured, 10, 64)
	if err != nil || value <= 0 {
		return defaultLimit
	}
	return value
}

func slicePlayerCacheRetention() time.Duration {
	const defaultRetention = 30 * 24 * time.Hour
	configured := strings.TrimSpace(os.Getenv("VIBESIM_SLICE_PLAYER_CACHE_RETENTION_HOURS"))
	if configured == "" {
		return defaultRetention
	}
	hours, err := strconv.ParseFloat(configured, 64)
	if err != nil || hours <= 0 {
		return defaultRetention
	}
	return time.Duration(hours * float64(time.Hour))
}

func slicePlayerElapsedMilliseconds(started time.Time) int64 {
	elapsed := time.Since(started)
	if elapsed > 0 && elapsed < time.Millisecond {
		return 1
	}
	return elapsed.Milliseconds()
}

func availableDiskBytes(path string) (int64, error) {
	var stats syscall.Statfs_t
	if err := syscall.Statfs(path, &stats); err != nil {
		return 0, err
	}
	return int64(stats.Bavail) * int64(stats.Bsize), nil
}

func slicePlayerDownloadCapacityError(sourceSize, available int64) error {
	if sourceSize <= 0 || available < 0 {
		return nil
	}
	const workingReserve = int64(512 << 20)
	required := sourceSize + workingReserve
	if required < sourceSize || available >= required {
		return nil
	}
	return fmt.Errorf("Insufficient local disk space for this time-series archive: %s is available, but the %s download needs at least %s including working space. Free disk space or remove old player caches, then retry", formatSlicePlayerBytes(available), formatSlicePlayerBytes(sourceSize), formatSlicePlayerBytes(required))
}

func humanizeSlicePlayerDownloadError(err error) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	if strings.Contains(strings.ToLower(message), "no space left on device") {
		return errors.New("Insufficient local disk space while downloading the time-series archive. Free disk space or remove old player caches, then retry")
	}
	lines := strings.Split(message, "\n")
	last := strings.TrimSpace(lines[len(lines)-1])
	if last == "" {
		last = "the Flow360 download command failed"
	}
	if len(last) > 500 {
		last = last[:500] + "…"
	}
	return fmt.Errorf("Could not download the time-series archive: %s", last)
}

func formatSlicePlayerBytes(value int64) string {
	const gib = float64(1 << 30)
	const mib = float64(1 << 20)
	if value >= 1<<30 {
		return strconv.FormatFloat(float64(value)/gib, 'f', 1, 64) + " GB"
	}
	return strconv.FormatFloat(float64(value)/mib, 'f', 0, 64) + " MB"
}
