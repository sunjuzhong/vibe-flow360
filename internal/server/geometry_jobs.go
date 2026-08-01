package server

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/geometrydiag"
)

type geometryDiagnosticsJobRequest struct {
	SmallSurfaceRatio float64 `json:"small_surface_ratio"`
	CurvatureAngleDeg float64 `json:"curvature_angle_deg"`
}

func (s *Server) startGeometryDiagnosticsJob(c *gin.Context) {
	resourceID := c.Param("resource_id")
	if err := flow360.ValidateResourcePath("Geometry", resourceID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.mirror == nil || s.geometryJobs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "asynchronous Geometry diagnostics are not configured"})
		return
	}
	var request geometryDiagnosticsJobRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "diagnostic settings must be valid JSON"})
		return
	}
	if request.SmallSurfaceRatio <= 0 || request.SmallSurfaceRatio > 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "small_surface_ratio must be greater than 0 and at most 1"})
		return
	}
	if request.CurvatureAngleDeg <= 0 || request.CurvatureAngleDeg > 180 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "curvature_angle_deg must be greater than 0 and at most 180"})
		return
	}
	manifest, err := s.mirror.GeometryVisualizationManifest(resourceID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "synchronize this Geometry before running diagnostics"})
		return
	}
	settings := geometrydiag.Settings{SmallSurfaceRatio: request.SmallSurfaceRatio, CurvatureAngleDeg: request.CurvatureAngleDeg}
	cacheKey := resourceID + ":" + geometrydiag.Fingerprint(manifest, nil, settings)
	job, err := s.geometryJobs.Create(resourceID, cacheKey, settings)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	go s.runGeometryDiagnosticsJob(job.ID, resourceID, cacheKey, manifest, settings)
	c.JSON(http.StatusAccepted, job)
}

func (s *Server) getGeometryDiagnosticsJob(c *gin.Context) {
	s.writeGeometryDiagnosticsJob(c, false)
}

func (s *Server) cancelGeometryDiagnosticsJob(c *gin.Context) {
	s.writeGeometryDiagnosticsJob(c, true)
}

func (s *Server) writeGeometryDiagnosticsJob(c *gin.Context, cancel bool) {
	resourceID := c.Param("resource_id")
	if err := flow360.ValidateResourcePath("Geometry", resourceID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.geometryJobs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "asynchronous Geometry diagnostics are not configured"})
		return
	}
	job, ok := s.geometryJobs.Get(c.Param("job_id"))
	if !ok || job.GeometryID != resourceID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Geometry diagnostic job not found"})
		return
	}
	if cancel {
		var err error
		job, err = s.geometryJobs.Cancel(job.ID)
		if err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, job)
}

func (s *Server) runGeometryDiagnosticsJob(jobID, resourceID, cacheKey string, manifest json.RawMessage, settings geometrydiag.Settings) {
	if report, ok := s.geometryJobs.GetCached(cacheKey); ok {
		_, _ = s.geometryJobs.Update(jobID, 95, "restoring-persistent-cache")
		_, _ = s.geometryJobs.Complete(jobID, report)
		return
	}
	if s.geometryJobSlots != nil {
		s.geometryJobSlots <- struct{}{}
		defer func() { <-s.geometryJobSlots }()
	}
	if s.geometryJobs.IsCancelled(jobID) {
		return
	}
	_, _ = s.geometryJobs.Update(jobID, 10, "loading-tessellation-index")
	buffers := map[string][]byte{}
	paths, pathErr := flow360.TessellationDefaultBinPaths(manifest)
	if pathErr == nil {
		for index, path := range paths {
			if s.geometryJobs.IsCancelled(jobID) {
				return
			}
			payload, readErr := s.mirror.GeometryVisualizationFile(resourceID, path)
			if readErr == nil {
				buffers[path] = payload
			}
			progress := 15 + (index+1)*35/maxInt(1, len(paths))
			_, _ = s.geometryJobs.Update(jobID, progress, "loading-tessellation-buffers")
		}
	}
	if s.geometryJobs.IsCancelled(jobID) {
		return
	}
	_, _ = s.geometryJobs.Update(jobID, 60, "analyzing-geometry-evidence")
	report, err := geometrydiag.AnalyzeWithBuffers(resourceID, manifest, buffers, settings)
	if err != nil {
		_, _ = s.geometryJobs.Fail(jobID, err)
		return
	}
	if s.geometryJobs.IsCancelled(jobID) {
		return
	}
	_, _ = s.geometryJobs.Update(jobID, 90, "persisting-diagnostic-result")
	if err := s.geometryJobs.PutCached(cacheKey, report); err != nil {
		_, _ = s.geometryJobs.Fail(jobID, err)
		return
	}
	_, _ = s.geometryJobs.Complete(jobID, report)
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
