package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/stepassets"
)

type stepVersionComparison struct {
	VersionID       string    `json:"version_id"`
	VolumeDelta     float64   `json:"volume_delta"`
	SolidCountDelta int       `json:"solid_count_delta"`
	FaceCountDelta  int       `json:"face_count_delta"`
	BoundsDelta     []float64 `json:"bounds_delta"`
}

func (s *Server) previewSTEPAssetVersion(c *gin.Context) {
	preview, comparison, err := s.ensureSTEPPreview(c.Request.Context(), c.Param("asset_id"), c.Param("version_id"), strings.TrimSpace(c.Query("compare_version_id")))
	if err != nil {
		log.Printf("STEP preview failed for asset %s version %s: %v", c.Param("asset_id"), c.Param("version_id"), err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": humanizeSTEPPreviewError(err), "code": "step_preview_failed"})
		return
	}
	compare := strings.TrimSpace(c.Query("compare_version_id"))
	assetURL := fmt.Sprintf("/api/step-assets/%s/versions/%s/preview.glb", c.Param("asset_id"), c.Param("version_id"))
	if compare != "" {
		assetURL += "?compare_version_id=" + compare
	}
	groups := []flow360.MeshGroup{{ID: "Selected version", Name: "Selected version", Color: "#268fee", Visible: true}}
	if compare != "" {
		groups = append(groups, flow360.MeshGroup{ID: "Comparison version", Name: "Comparison version", Color: "#f2731c", Visible: true})
	}
	result := gin.H{"asset_url": assetURL, "format": "gltf", "bounding_box": flow360.BoundingBox{Min: [3]float64{preview.Bounds[0], preview.Bounds[1], preview.Bounds[2]}, Max: [3]float64{preview.Bounds[3], preview.Bounds[4], preview.Bounds[5]}}, "groups": groups, "vertices": preview.Vertices, "elements": preview.Triangles}
	if comparison != nil {
		result["comparison"] = comparison
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}

func (s *Server) previewSTEPAssetVersionFile(c *gin.Context) {
	_, _, err := s.ensureSTEPPreview(c.Request.Context(), c.Param("asset_id"), c.Param("version_id"), strings.TrimSpace(c.Query("compare_version_id")))
	if err != nil {
		log.Printf("STEP preview file failed for asset %s version %s: %v", c.Param("asset_id"), c.Param("version_id"), err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": humanizeSTEPPreviewError(err), "code": "step_preview_failed"})
		return
	}
	c.File(s.stepPreviewPath(c.Param("version_id"), strings.TrimSpace(c.Query("compare_version_id"))))
}

func humanizeSTEPPreviewError(err error) string {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "must pass validation") || strings.Contains(message, "not ready") {
		return "This STEP version must pass validation before preview."
	}
	if strings.Contains(message, "not found") {
		return "The STEP version is no longer available."
	}
	return "The STEP preview could not be generated. Retry the preview or validate this version again."
}

func (s *Server) stepPreviewPath(versionID, compareVersionID string) string {
	name := versionID
	if compareVersionID != "" {
		name += "--" + compareVersionID
	}
	return filepath.Join(s.workDir, "step-previews", name+".glb")
}

func (s *Server) stepPreviewMetadataPath(versionID, compareVersionID string) string {
	return strings.TrimSuffix(s.stepPreviewPath(versionID, compareVersionID), ".glb") + ".json"
}

func (s *Server) ensureSTEPPreview(ctx context.Context, assetID, versionID, compareVersionID string) (aicreate.STEPPreview, *stepVersionComparison, error) {
	var result aicreate.STEPPreview
	version, path, ok := s.stepAssets.Version(assetID, versionID)
	if !ok {
		return result, nil, errors.New("STEP version not found")
	}
	if version.Validation.Status != stepassets.StatusReady || version.Validation.Report == nil {
		return result, nil, errors.New("STEP version must pass validation before preview")
	}
	paths := []string{path}
	reports := []*aicreate.GeometryValidation{version.Validation.Report}
	if compareVersionID != "" {
		compare, comparePath, found := s.stepAssets.Version(assetID, compareVersionID)
		if !found || compare.Validation.Status != stepassets.StatusReady || compare.Validation.Report == nil {
			return result, nil, errors.New("comparison STEP version is not ready")
		}
		paths = append(paths, comparePath)
		reports = append(reports, compare.Validation.Report)
	}
	output := s.stepPreviewPath(versionID, compareVersionID)
	metadataOutput := s.stepPreviewMetadataPath(versionID, compareVersionID)
	if err := os.MkdirAll(filepath.Dir(output), 0o700); err != nil {
		return result, nil, err
	}
	metadata, metadataErr := os.ReadFile(metadataOutput)
	if metadataErr == nil {
		metadataErr = json.Unmarshal(metadata, &result)
	}
	info, outputErr := os.Stat(output)
	if outputErr != nil || info.Size() == 0 || metadataErr != nil || len(result.Bounds) != 6 {
		if s.stepPreviewer == nil {
			return result, nil, errors.New("STEP preview runtime is unavailable")
		}
		generated, err := s.stepPreviewer.PreviewSTEP(ctx, paths, output)
		if err != nil {
			return result, nil, err
		}
		result = generated
		encoded, err := json.Marshal(result)
		if err != nil {
			return result, nil, err
		}
		if err := os.WriteFile(metadataOutput, encoded, 0o600); err != nil {
			return result, nil, fmt.Errorf("cache STEP preview metadata: %w", err)
		}
	}
	if len(result.Bounds) != 6 {
		return result, nil, errors.New("STEP preview has invalid bounds")
	}
	if len(reports) == 1 {
		return result, nil, nil
	}
	boundsDelta := make([]float64, 6)
	if len(reports[0].Bounds) == 6 && len(reports[1].Bounds) == 6 {
		for index := range boundsDelta {
			boundsDelta[index] = reports[0].Bounds[index] - reports[1].Bounds[index]
		}
	}
	comparison := &stepVersionComparison{VersionID: compareVersionID, VolumeDelta: reports[0].Volume - reports[1].Volume, SolidCountDelta: reports[0].SolidCount - reports[1].SolidCount, FaceCountDelta: reports[0].FaceCount - reports[1].FaceCount, BoundsDelta: boundsDelta}
	return result, comparison, nil
}

const maxSTEPUploadBytes = 256 << 20

type createSTEPProjectRequest struct {
	FolderID string `json:"folder_id"`
	Name     string `json:"name"`
}

type aiDesignSTEPRequest struct {
	Prompt          string `json:"prompt"`
	Name            string `json:"name,omitempty"`
	AssetID         string `json:"asset_id,omitempty"`
	ParentVersionID string `json:"parent_version_id,omitempty"`
	FolderID        string `json:"folder_id,omitempty"`
}

type stepFolderRequest struct {
	Name     *string `json:"name,omitempty"`
	ParentID *string `json:"parent_id,omitempty"`
}

func (s *Server) listSTEPAssets(c *gin.Context) {
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"assets": s.stepAssets.List(), "folder_root": s.stepAssets.FolderTree()})
}

func (s *Server) createSTEPFolder(c *gin.Context) {
	var request stepFolderRequest
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.Name == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder name is required"})
		return
	}
	parentID := stepassets.RootFolderID
	if request.ParentID != nil {
		parentID = *request.ParentID
	}
	folder, err := s.stepAssets.CreateFolder(parentID, *request.Name)
	if err != nil {
		writeSTEPFolderError(c, err)
		return
	}
	c.JSON(http.StatusCreated, folder)
}

func (s *Server) updateSTEPFolder(c *gin.Context) {
	var request stepFolderRequest
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	if err := c.ShouldBindJSON(&request); err != nil || (request.Name == nil && request.ParentID == nil) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder name or parent_id is required"})
		return
	}
	var folder stepassets.Folder
	var err error
	if request.Name != nil {
		folder, err = s.stepAssets.RenameFolder(c.Param("folder_id"), *request.Name)
	}
	if err == nil && request.ParentID != nil {
		folder, err = s.stepAssets.MoveFolder(c.Param("folder_id"), *request.ParentID)
	}
	if err != nil {
		writeSTEPFolderError(c, err)
		return
	}
	c.JSON(http.StatusOK, folder)
}

func (s *Server) deleteSTEPFolder(c *gin.Context) {
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	if err := s.stepAssets.DeleteFolder(c.Param("folder_id")); err != nil {
		writeSTEPFolderError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) moveSTEPAsset(c *gin.Context) {
	var request struct {
		FolderID string `json:"folder_id"`
	}
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	if err := c.ShouldBindJSON(&request); err != nil || strings.TrimSpace(request.FolderID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder_id is required"})
		return
	}
	asset, err := s.stepAssets.MoveAsset(c.Param("asset_id"), request.FolderID)
	if err != nil {
		writeSTEPFolderError(c, err)
		return
	}
	c.JSON(http.StatusOK, asset)
}

func writeSTEPFolderError(c *gin.Context, err error) {
	status := http.StatusConflict
	if errors.Is(err, os.ErrNotExist) {
		status = http.StatusNotFound
	}
	if strings.Contains(err.Error(), "required") {
		status = http.StatusBadRequest
	}
	c.JSON(status, gin.H{"error": err.Error()})
}

func (s *Server) getSTEPAsset(c *gin.Context) {
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	asset, ok := s.stepAssets.Get(c.Param("asset_id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "STEP asset not found"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, asset)
}

func (s *Server) createSTEPAsset(c *gin.Context) {
	s.storeSTEPAssetUpload(c, "")
}

func (s *Server) createSTEPAssetVersion(c *gin.Context) {
	s.storeSTEPAssetUpload(c, c.Param("asset_id"))
}

func (s *Server) aiDesignSTEPAsset(c *gin.Context) {
	if s.stepAssets == nil || s.agent == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library or geometry Agent is not configured"})
		return
	}
	var request aiDesignSTEPRequest
	if err := c.ShouldBindJSON(&request); err != nil || strings.TrimSpace(request.Prompt) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a geometry design or modification prompt is required"})
		return
	}
	job, err := s.stepAssets.CreateAIJob(stepassets.AIJobRequest{
		Prompt: request.Prompt, Name: request.Name,
		AssetID: request.AssetID, ParentVersionID: request.ParentVersionID, FolderID: request.FolderID,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	s.startAISTEPJob(job.ID)
	c.JSON(http.StatusAccepted, job)
}

func (s *Server) getAISTEPJob(c *gin.Context) {
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	job, ok := s.stepAssets.AIJob(c.Param("job_id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "AI STEP job not found"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, job)
}

func (s *Server) cancelAISTEPJob(c *gin.Context) {
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	job, ok := s.stepAssets.AIJob(c.Param("job_id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "AI STEP job not found"})
		return
	}
	if job.Status == "completed" || job.Status == "failed" || job.Status == "needs_input" || job.Status == "cancelled" {
		c.JSON(http.StatusConflict, gin.H{"error": "AI STEP job is already finished"})
		return
	}
	s.stepJobMu.Lock()
	cancel := s.stepJobCancels[job.ID]
	s.stepJobMu.Unlock()
	if cancel != nil {
		cancel()
	}
	job, _ = s.stepAssets.FinishAIJob(job.ID, "cancelled", "", "", "Generation was cancelled; no STEP version was created.", "", nil)
	c.JSON(http.StatusOK, job)
}

func (s *Server) startAISTEPJob(jobID string) {
	go s.runAISTEPJob(jobID)
}

func (s *Server) runAISTEPJob(jobID string) {
	if s.stepAssets == nil {
		return
	}
	job, ok := s.stepAssets.AIJob(jobID)
	if !ok {
		return
	}
	if s.stepJobSlots != nil {
		s.stepJobSlots <- struct{}{}
		defer func() { <-s.stepJobSlots }()
	}
	if current, exists := s.stepAssets.AIJob(jobID); !exists || current.Status == "cancelled" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	s.stepJobMu.Lock()
	if s.stepJobCancels == nil {
		s.stepJobCancels = map[string]context.CancelFunc{}
	}
	s.stepJobCancels[jobID] = cancel
	s.stepJobMu.Unlock()
	defer func() {
		cancel()
		s.stepJobMu.Lock()
		delete(s.stepJobCancels, jobID)
		s.stepJobMu.Unlock()
	}()

	_, _ = s.stepAssets.UpdateAIJob(jobID, "running", "designing", 15, "The geometry Agent is preparing a constrained exact-CAD recipe.")
	var blueprint aicreate.Blueprint
	var err error
	request := job.Request
	if strings.TrimSpace(request.AssetID) == "" {
		blueprint, err = aicreate.Design(ctx, s.agent, request.Prompt)
	} else {
		version, _, ok := s.stepAssets.Version(request.AssetID, request.ParentVersionID)
		if !ok {
			s.finishAISTEPJobError(jobID, "Parent STEP version not found.")
			return
		}
		if version.Geometry == nil {
			s.finishAISTEPJobError(jobID, "This uploaded STEP has no editable AI CAD recipe. Upload a revised file as a new version, or create a new AI-authored design.")
			return
		}
		blueprint, err = aicreate.ReviseGeometry(ctx, s.agent, *version.Geometry, request.Prompt)
	}
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			return
		}
		var missing *aicreate.MissingInputError
		if errors.As(err, &missing) {
			_, _ = s.stepAssets.FinishAIJob(jobID, "needs_input", "", "", "The geometry Agent needs more defining information.", err.Error(), missing.Fields)
			return
		}
		s.finishAISTEPJobError(jobID, humanizeAICreateDesignError(err))
		return
	}
	_, _ = s.stepAssets.UpdateAIJob(jobID, "running", "generating", 55, "CadQuery/OpenCascade is generating and round-trip validating exact STEP geometry.")
	stagingRoot := filepath.Join(s.workDir, "step-library", "staging")
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		s.finishAISTEPJobError(jobID, "Could not prepare STEP generation storage.")
		return
	}
	directory, err := os.MkdirTemp(stagingRoot, "ai-step-")
	if err != nil {
		s.finishAISTEPJobError(jobID, "Could not prepare STEP generation workspace.")
		return
	}
	defer os.RemoveAll(directory)
	fileName := safeGeometryName(blueprint.Geometry.Name) + ".step"
	path := filepath.Join(directory, fileName)
	generator := s.cadGenerator
	if generator == nil {
		generator = aicreate.NewCadQueryGenerator()
	}
	blueprint, validation, err := s.generateAICreateCAD(
		ctx, generator,
		aiCreateSession{Intent: request.Prompt}, blueprint, path, "",
	)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return
		}
		s.finishAISTEPJobError(jobID, humanizeAICreateGenerationError(err))
		return
	}
	if current, ok := s.stepAssets.AIJob(jobID); !ok || current.Status == "cancelled" {
		return
	}
	_, _ = s.stepAssets.UpdateAIJob(jobID, "running", "storing", 85, "The validated STEP and editable CAD recipe are being stored as an immutable version.")
	file, err := os.Open(path)
	if err != nil {
		s.finishAISTEPJobError(jobID, "Generated STEP checkpoint could not be stored.")
		return
	}
	defer file.Close()
	if current, ok := s.stepAssets.AIJob(jobID); !ok || current.Status == "cancelled" {
		return
	}
	var asset stepassets.Asset
	var version stepassets.Version
	if strings.TrimSpace(request.AssetID) == "" {
		name := firstSTEPValue(request.Name, blueprint.ProjectName, blueprint.Geometry.Name)
		folderID := firstSTEPValue(request.FolderID, stepassets.RootFolderID)
		asset, version, err = s.stepAssets.CreateInFolder(folderID, name, blueprint.Summary, fileName, "m", "ai", request.Prompt, "", file)
	} else {
		asset, version, err = s.stepAssets.AddVersion(request.AssetID, fileName, "m", "ai", request.Prompt, request.ParentVersionID, file)
	}
	if err != nil {
		s.finishAISTEPJobError(jobID, err.Error())
		return
	}
	if _, err := s.stepAssets.SetGeometry(asset.ID, version.ID, blueprint.Geometry); err != nil {
		s.finishAISTEPJobError(jobID, "Generated CAD recipe could not be checkpointed.")
		return
	}
	version, err = s.stepAssets.SetValidation(asset.ID, version.ID, stepassets.Validation{Status: stepassets.StatusReady, Report: &validation})
	if err != nil {
		s.finishAISTEPJobError(jobID, "Generated STEP validation could not be checkpointed.")
		return
	}
	_, _ = s.stepAssets.FinishAIJob(jobID, "completed", asset.ID, version.ID, "The exact STEP version is validated and ready.", "", nil)
}

func (s *Server) finishAISTEPJobError(jobID, message string) {
	if current, ok := s.stepAssets.AIJob(jobID); ok && current.Status != "cancelled" {
		_, _ = s.stepAssets.FinishAIJob(jobID, "failed", "", "", "AI STEP generation stopped before creating a version.", message, nil)
	}
}

func (s *Server) resumeAISTEPJobs() {
	if s.stepAssets == nil {
		return
	}
	jobs, err := s.stepAssets.RecoverAIJobs()
	if err != nil {
		log.Printf("Could not recover AI STEP jobs: %v", err)
		return
	}
	for _, job := range jobs {
		s.startAISTEPJob(job.ID)
	}
}

func (s *Server) storeSTEPAssetUpload(c *gin.Context, assetID string) {
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSTEPUploadBytes)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a STEP file is required"})
		return
	}
	defer file.Close()
	unit := strings.TrimSpace(c.PostForm("unit"))
	var asset stepassets.Asset
	var version stepassets.Version
	if assetID == "" {
		asset, version, err = s.stepAssets.CreateInFolder(
			firstSTEPValue(c.PostForm("folder_id"), stepassets.RootFolderID), c.PostForm("name"), c.PostForm("description"), header.Filename, unit,
			"upload", "", "", file,
		)
	} else {
		asset, version, err = s.stepAssets.AddVersion(
			assetID, header.Filename, unit, firstSTEPValue(c.PostForm("source"), "upload"),
			c.PostForm("prompt"), c.PostForm("parent_version_id"), file,
		)
	}
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	s.startSTEPValidation(asset.ID, version.ID)
	c.JSON(http.StatusCreated, gin.H{"asset": asset, "version": version})
}

func (s *Server) validateSTEPAssetVersion(c *gin.Context) {
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	version, _, ok := s.stepAssets.Version(c.Param("asset_id"), c.Param("version_id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "STEP version not found"})
		return
	}
	version, err := s.stepAssets.SetValidation(version.AssetID, version.ID, stepassets.Validation{Status: stepassets.StatusValidating})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.startSTEPValidation(version.AssetID, version.ID)
	c.JSON(http.StatusAccepted, version)
}

func (s *Server) startSTEPValidation(assetID, versionID string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		_, path, ok := s.stepAssets.Version(assetID, versionID)
		if !ok {
			return
		}
		validator := s.stepValidator
		if validator == nil {
			validator = aicreate.NewCadQueryGenerator()
		}
		report, err := validator.ValidateSTEP(ctx, path)
		if err != nil {
			message := lastAICreateDiagnosticLine(err.Error())
			if message == "" {
				message = "Exact STEP validation failed."
			}
			if _, storeErr := s.stepAssets.SetValidation(assetID, versionID, stepassets.Validation{Status: stepassets.StatusBlocked, Error: message}); storeErr != nil {
				log.Printf("Could not persist STEP validation failure for %s: %v", versionID, storeErr)
			}
			return
		}
		if _, err := s.stepAssets.SetValidation(assetID, versionID, stepassets.Validation{Status: stepassets.StatusReady, Report: &report}); err != nil {
			log.Printf("Could not persist STEP validation report for %s: %v", versionID, err)
		}
	}()
}

func (s *Server) resumeSTEPValidations() {
	if s.stepAssets == nil {
		return
	}
	for _, asset := range s.stepAssets.List() {
		for _, version := range asset.Versions {
			if version.Validation.Status == stepassets.StatusValidating {
				s.startSTEPValidation(asset.ID, version.ID)
			}
		}
	}
}

func (s *Server) downloadSTEPAssetVersion(c *gin.Context) {
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	version, path, ok := s.stepAssets.Version(c.Param("asset_id"), c.Param("version_id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "STEP version not found"})
		return
	}
	name := strings.ReplaceAll(filepath.Base(version.FileName), "\"", "")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", name))
	c.Header("Content-Type", "model/step")
	c.File(path)
}

func (s *Server) createProjectFromSTEPAsset(c *gin.Context) {
	if s.stepAssets == nil || s.flow360 == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library or Flow360 is not configured"})
		return
	}
	asset, assetOK := s.stepAssets.Get(c.Param("asset_id"))
	version, path, versionOK := s.stepAssets.Version(c.Param("asset_id"), c.Param("version_id"))
	if !assetOK || !versionOK {
		c.JSON(http.StatusNotFound, gin.H{"error": "STEP version not found"})
		return
	}
	if version.Validation.Status != stepassets.StatusReady {
		c.JSON(http.StatusConflict, gin.H{"error": "STEP version must pass exact validation before it can create a Flow360 Project"})
		return
	}
	var request createSTEPProjectRequest
	if err := c.ShouldBindJSON(&request); err != nil || strings.TrimSpace(request.FolderID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "destination folder_id is required"})
		return
	}
	projectName := firstSTEPValue(strings.TrimSpace(request.Name), asset.Name)
	startedAt := time.Now().UTC()
	raw, err := s.flow360.CreateProjectSync(
		c.Request.Context(), []string{path}, "geometry", projectName,
		version.Unit, "standard", "", request.FolderID, []string{"step-library", asset.ID, version.ID},
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": humanizeAICreateProjectError(err)})
		return
	}
	if findProjectIDFromRaw(raw) == "" {
		if reconciled, reconcileErr := reconcileAICreateProjectResult(
			c.Request.Context(), raw, projectName, "geometry", startedAt.Add(-30*time.Second),
			func(ctx context.Context, name, sourceType string, notBefore time.Time) (json.RawMessage, error) {
				return s.flow360.FindProjectByName(ctx, request.FolderID, name, sourceType, notBefore)
			}, aiCreateProjectReconcileAttempts, aiCreateProjectReconcileDelay,
		); reconcileErr == nil {
			raw = reconciled
		}
	}
	normalized, err := s.normalizeAICreateResult(c.Request.Context(), raw, "geometry")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	var result map[string]any
	if err := json.Unmarshal(normalized, &result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read created Flow360 Project"})
		return
	}
	result["step_asset_id"] = asset.ID
	result["step_version_id"] = version.ID
	c.JSON(http.StatusCreated, result)
}

func firstSTEPValue(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
