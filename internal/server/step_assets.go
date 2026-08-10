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
	"github.com/sunjuzhong/vibe-flow360/internal/stepassets"
)

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
}

func (s *Server) listSTEPAssets(c *gin.Context) {
	if s.stepAssets == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "STEP library is not configured"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"assets": s.stepAssets.List()})
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
	var blueprint aicreate.Blueprint
	var err error
	if strings.TrimSpace(request.AssetID) == "" {
		blueprint, err = aicreate.Design(c.Request.Context(), s.agent, request.Prompt)
	} else {
		version, _, ok := s.stepAssets.Version(request.AssetID, request.ParentVersionID)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "parent STEP version not found"})
			return
		}
		if version.Geometry == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "This uploaded STEP has no editable AI CAD recipe. Upload a revised file as a new version, or create a new AI-authored design."})
			return
		}
		blueprint, err = aicreate.ReviseGeometry(c.Request.Context(), s.agent, *version.Geometry, request.Prompt)
	}
	if err != nil {
		var missing *aicreate.MissingInputError
		if errors.As(err, &missing) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "fields": missing.Fields})
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": humanizeAICreateDesignError(err)})
		return
	}
	stagingRoot := filepath.Join(s.workDir, "step-library", "staging")
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare STEP generation storage"})
		return
	}
	directory, err := os.MkdirTemp(stagingRoot, "ai-step-")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare STEP generation workspace"})
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
		c.Request.Context(), generator,
		aiCreateSession{Intent: request.Prompt}, blueprint, path, "",
	)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": humanizeAICreateGenerationError(err)})
		return
	}
	file, err := os.Open(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "generated STEP checkpoint could not be stored"})
		return
	}
	defer file.Close()
	var asset stepassets.Asset
	var version stepassets.Version
	if strings.TrimSpace(request.AssetID) == "" {
		name := firstSTEPValue(request.Name, blueprint.ProjectName, blueprint.Geometry.Name)
		asset, version, err = s.stepAssets.Create(name, blueprint.Summary, fileName, "m", "ai", request.Prompt, "", file)
	} else {
		asset, version, err = s.stepAssets.AddVersion(request.AssetID, fileName, "m", "ai", request.Prompt, request.ParentVersionID, file)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := s.stepAssets.SetGeometry(asset.ID, version.ID, blueprint.Geometry); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "generated CAD recipe could not be checkpointed"})
		return
	}
	version, err = s.stepAssets.SetValidation(asset.ID, version.ID, stepassets.Validation{Status: stepassets.StatusReady, Report: &validation})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "generated STEP validation could not be checkpointed"})
		return
	}
	asset, _ = s.stepAssets.Get(asset.ID)
	c.JSON(http.StatusCreated, gin.H{"asset": asset, "version": version})
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
		asset, version, err = s.stepAssets.Create(
			c.PostForm("name"), c.PostForm("description"), header.Filename, unit,
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
