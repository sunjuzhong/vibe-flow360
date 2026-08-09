package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Case slice preparation is not configured"})
		return
	}
	var request slicePlayerRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "slice preparation request must be valid JSON"})
		return
	}
	request.ResultPath = strings.TrimSpace(request.ResultPath)
	if !validSliceArchivePath(request.ResultPath) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "result_path must identify results/slices.tar.gz"})
		return
	}
	if request.SizeBytes < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "size_bytes cannot be negative"})
		return
	}
	maxArchiveBytes := slicePlayerMaxArchiveBytes()
	if request.SizeBytes > maxArchiveBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": fmt.Sprintf("Slice archive exceeds the configured %d byte local preparation limit", maxArchiveBytes)})
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
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Case slice preparation is not configured"})
		return
	}
	job, ok := s.slicePlayerJobs.Latest(caseID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "No slice preparation exists for this Case"})
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
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Case slice preparation is not configured"})
		return
	}
	job, ok := s.slicePlayerJobs.Get(c.Param("job_id"))
	if !ok || job.CaseID != caseID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Case slice preparation was not found"})
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
	if index, ok := s.slicePlayerJobs.Cached(cacheKey); ok {
		_, _ = s.slicePlayerJobs.Update(jobID, 98, "restoring-index-cache")
		_, _ = s.slicePlayerJobs.Complete(jobID, index)
		return
	}
	if s.slicePlayerSlots != nil {
		s.slicePlayerSlots <- struct{}{}
		defer func() { <-s.slicePlayerSlots }()
	}
	if s.slicePlayerJobs.IsCancelled(jobID) {
		return
	}

	downloadDir := filepath.Join(s.workDir, "slice-player", "downloads", jobID)
	if err := os.MkdirAll(downloadDir, 0o700); err != nil {
		_, _ = s.slicePlayerJobs.Fail(jobID, err)
		return
	}
	defer os.RemoveAll(downloadDir)
	_, _ = s.slicePlayerJobs.Update(jobID, 5, "downloading-archive")
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Minute)
	s.registerSlicePlayerCancel(jobID, cancel)
	defer func() {
		s.unregisterSlicePlayerCancel(jobID)
		cancel()
	}()
	archivePath, err := s.flow360.DownloadCaseResultTo(ctx, caseID, resultPath, downloadDir, slicePlayerMaxArchiveBytes())
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
	_, _ = s.slicePlayerJobs.Update(jobID, 35, "scanning-archive")
	lastProgress := -1
	index, err := sliceplayer.ScanTarGz(archivePath, sliceplayer.DefaultLimits, func(percent int, _ int64) bool {
		if s.slicePlayerJobs.IsCancelled(jobID) {
			return false
		}
		if percent > lastProgress {
			lastProgress = percent
			_, _ = s.slicePlayerJobs.Update(jobID, 35+(percent*60/100), "scanning-archive")
		}
		return true
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
	_, _ = s.slicePlayerJobs.Update(jobID, 97, "persisting-frame-index")
	if _, err := s.slicePlayerJobs.Complete(jobID, index); err != nil {
		_, _ = s.slicePlayerJobs.Fail(jobID, err)
	}
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

func validSliceArchivePath(resultPath string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(resultPath, "\\", "/"))
	return normalized == "results/slices.tar.gz"
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
