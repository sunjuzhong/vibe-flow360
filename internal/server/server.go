package server

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/sjzsdu/vibesim/internal/agent"
	"github.com/sjzsdu/vibesim/internal/comparison"
	"github.com/sjzsdu/vibesim/internal/convergence"
	"github.com/sjzsdu/vibesim/internal/flow360"
	importplans "github.com/sjzsdu/vibesim/internal/imports"
	"github.com/sjzsdu/vibesim/internal/plans"
	"github.com/sjzsdu/vibesim/internal/projectcache"
	"github.com/sjzsdu/vibesim/internal/projectmirror"
)

//go:embed dist
var webFS embed.FS

type Server struct {
	router  *gin.Engine
	flow360 *flow360.Client
	agent   *agent.Service
	plans   *plans.Store
	imports *importplans.Store
	cache   *projectcache.Store
	mirror  *projectmirror.Store
	workDir string

	projectSyncClient projectSyncClient
	projectSyncMu     sync.Mutex
	projectSyncJobs   map[string]struct{}
}

func New() *Server {
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())
	dataDir := strings.TrimSpace(os.Getenv("VIBESIM_DATA_DIR"))
	if dataDir == "" {
		dataDir = ".vibesim"
	}
	flowClient := flow360.NewClient()
	planStore, err := plans.NewStore(filepath.Join(dataDir, "plans"))
	if err != nil {
		panic(err)
	}
	importStore, err := importplans.New(filepath.Join(dataDir, "imports"))
	if err != nil {
		panic(err)
	}
	cacheStore, err := projectcache.New(filepath.Join(
		dataDir,
		"cache",
		"flow360",
		cacheNamespace(flowClient.Environment, flowClient.Profile),
	))
	if err != nil {
		panic(err)
	}
	mirrorStore, err := projectmirror.New(
		filepath.Join(dataDir, "projects"),
		cacheNamespace(flowClient.Environment, flowClient.Profile),
	)
	if err != nil {
		panic(err)
	}

	app := &Server{
		router:            router,
		flow360:           flowClient,
		agent:             agent.NewService(),
		plans:             planStore,
		imports:           importStore,
		cache:             cacheStore,
		mirror:            mirrorStore,
		workDir:           dataDir,
		projectSyncClient: flowClient,
		projectSyncJobs:   map[string]struct{}{},
	}
	app.routes()

	go app.startImportCleanupLoop()
	go app.startCacheCleanupLoop()
	go app.reconcileInterruptedPlans()

	return app
}

func (s *Server) reconcileInterruptedPlans() {
	list, err := s.plans.List("", "")
	if err != nil {
		log.Printf("Could not list plans for reconciliation: %v", err)
		return
	}
	for _, plan := range list {
		if plan.Status != plans.StatusReconciling {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		result, lookupErr := s.flow360.FindDraftByName(ctx, plan.ProjectID, plan.Name)
		cancel()
		if lookupErr != nil {
			if _, err := s.plans.MarkReconcilePending(plan.ID, lookupErr); err != nil {
				log.Printf("Could not persist reconciliation state for %s: %v", plan.ID, err)
			}
			continue
		}
		if _, err := s.plans.MarkSubmitted(plan.ID, result); err != nil {
			log.Printf("Could not persist reconciled plan %s: %v", plan.ID, err)
		}
	}
}

func (s *Server) startCacheCleanupLoop() {
	cleanup := func() {
		removed, err := s.cache.Cleanup(projectcache.DefaultRetention)
		if err != nil {
			log.Printf("Flow360 cache cleanup error: %v", err)
		} else if removed > 0 {
			log.Printf("Cleaned up %d expired Flow360 cache snapshots", removed)
		}
	}
	cleanup()
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		cleanup()
	}
}

func (s *Server) startImportCleanupLoop() {
	cleanup := func() {
		removed, err := s.imports.Cleanup(importplans.DefaultCleanupAge)
		if err != nil {
			log.Printf("Import cleanup error: %v", err)
		} else if removed > 0 {
			log.Printf("Cleaned up %d expired import staging directories", removed)
		}
	}

	cleanup()

	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		cleanup()
	}
}

func (s *Server) Run(addr string) error {
	return s.router.Run(addr)
}

func (s *Server) routes() {
	api := s.router.Group("/api")
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"ok": true, "service": "vibesim"})
		})
		api.GET("/flow360/status", s.flow360Status)
		api.GET("/flow360/projects", s.flow360Projects)
		api.GET("/flow360/folders", s.flow360Folders)
		api.GET("/flow360/projects/:project_id", s.flow360ProjectInfo)
		api.GET("/flow360/projects/:project_id/tree", s.flow360ProjectTree)
		api.GET("/flow360/projects/:project_id/items", s.flow360ProjectItems)
		api.GET("/flow360/projects/:project_id/sync", s.projectSyncStatus)
		api.POST("/flow360/projects/:project_id/sync", s.startProjectSync)
		api.GET("/flow360/resources/:resource_type/:resource_id", s.flow360ResourceDetail)
		api.GET("/flow360/resources/:resource_type/:resource_id/logs", s.flow360ResourceLogs)
		api.GET("/flow360/resources/:resource_type/:resource_id/download", s.flow360ResourceDownload)
		api.GET("/flow360/resources/:resource_type/:resource_id/preview", s.flow360ResourcePreview)
		api.GET("/flow360/resources/:resource_type/:resource_id/preview-mesh", s.flow360ResourceMeshPreview)
		api.GET("/flow360/resources/:resource_type/:resource_id/visualization/*asset_path", s.flow360ResourceVisualizationAsset)
		api.GET("/flow360/resources/:resource_type/:resource_id/convergence", s.flow360CaseConvergence)
		api.POST("/flow360/compare", s.compareCases)
		api.POST("/flow360/sweep", s.generateSweepPlan)
		api.GET("/plans", s.listPlans)
		api.POST("/plans", s.createPlan)
		api.GET("/plans/:plan_id", s.getPlan)
		api.POST("/plans/:plan_id/preflight", s.preflightPlan)
		api.POST("/plans/:plan_id/inputs", s.applyPlanInputs)
		api.POST("/plans/:plan_id/approve", s.approvePlan)
		api.POST("/plans/:plan_id/run", s.runPlan)
		api.POST("/imports", s.stageImport)
		api.GET("/imports", s.listImports)
		api.GET("/imports/:import_id", s.getImport)
		api.POST("/imports/:import_id/approve", s.approveImport)
		api.POST("/imports/:import_id/run", s.runImport)
		api.DELETE("/imports/:import_id", s.abortImport)
		api.GET("/agent/state", func(c *gin.Context) {
			c.JSON(http.StatusOK, s.agent.State())
		})
		api.POST("/agent/chat/stream", s.chatStream)
		api.POST("/agent/plan-from-action", s.planFromAction)
	}

	dist, err := fs.Sub(webFS, "dist")
	if err != nil {
		panic(err)
	}
	indexHTML, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		panic(err)
	}
	s.router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		trimmed := strings.TrimPrefix(path, "/")
		if trimmed != "" {
			if _, err := fs.Stat(dist, trimmed); err == nil {
				c.FileFromFS(trimmed, http.FS(dist))
				return
			}
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	})
}

func (s *Server) stageImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 5<<30)

	sourceType := strings.TrimSpace(c.Query("source_type"))
	if sourceType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source_type query parameter is required"})
		return
	}

	name := strings.TrimSpace(c.Query("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project name is required"})
		return
	}

	unit := strings.TrimSpace(c.DefaultQuery("unit", "m"))
	workflow := strings.TrimSpace(c.DefaultQuery("workflow", ""))
	solverVersion := strings.TrimSpace(c.DefaultQuery("solver_version", ""))
	folderID := strings.TrimSpace(c.DefaultQuery("folder_id", ""))
	rawTags := strings.TrimSpace(c.DefaultQuery("tags", ""))

	if sourceType != "geometry" && sourceType != "surface-mesh" && sourceType != "volume-mesh" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported source type"})
		return
	}

	var tags []string
	if rawTags != "" {
		for _, t := range strings.Split(rawTags, ",") {
			trimmed := strings.TrimSpace(t)
			if trimmed != "" {
				tags = append(tags, trimmed)
			}
		}
	}

	plan := importplans.Plan{
		Name:          name,
		SourceType:    sourceType,
		Unit:          unit,
		UnitConfirmed: sourceType != "geometry",
		Workflow:      workflow,
		SolverVersion: solverVersion,
		FolderID:      folderID,
		Tags:          tags,
	}

	if plan.Unit == "" {
		plan.Unit = "m"
	}
	if sourceType == "geometry" && plan.Workflow == "" {
		plan.Workflow = "standard"
	} else if sourceType != "geometry" {
		plan.Workflow = ""
	}

	reader, err := c.Request.MultipartReader()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid multipart request"})
		return
	}

	created, _, err := s.imports.Create(plan)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not stage import"})
		return
	}

	allowedExtensions := map[string][]string{
		"geometry":     {".step", ".stp", ".igs", ".iges", ".brep", ".cax", ".catpart", ".catproduct"},
		"surface-mesh": {".cgns", ".dat", ".key", ".k", ".msh", ".nas", ".bdf", ".inp", ".vtk", ".vtu"},
		"volume-mesh":  {".cgns", ".dat", ".key", ".k", ".msh", ".nas", ".bdf", ".inp", ".vtk", ".vtu"},
	}
	allowed := allowedExtensions[sourceType]

	var files []importplans.FileInfo
	var totalSize int64
	consecutiveErrors := 0

	for {
		part, partErr := reader.NextPart()
		if partErr == io.EOF {
			break
		}
		if partErr != nil {
			consecutiveErrors++
			if consecutiveErrors > 3 {
				_ = s.imports.Abort(created.ID)
				c.JSON(http.StatusBadRequest, gin.H{"error": "upload stream error"})
				return
			}
			continue
		}

		if part.FileName() == "" {
			part.Close()
			continue
		}

		consecutiveErrors = 0

		filename := part.FileName()
		ext := strings.ToLower(filepath.Ext(filename))
		found := false
		for _, allowedExt := range allowed {
			if ext == allowedExt {
				found = true
				break
			}
		}
		if !found {
			part.Close()
			_ = s.imports.Abort(created.ID)
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unsupported file extension %q for %s import (allowed: %s)", ext, sourceType, strings.Join(allowed, ", "))})
			return
		}

		if len(files) >= 20 {
			part.Close()
			_ = s.imports.Abort(created.ID)
			c.JSON(http.StatusBadRequest, gin.H{"error": "maximum file count exceeded (20)"})
			return
		}

		fileInfo, addErr := s.imports.AddFile(created.ID, filename, part)
		part.Close()
		if addErr != nil {
			_ = s.imports.Abort(created.ID)
			c.JSON(http.StatusInternalServerError, gin.H{"error": addErr.Error()})
			return
		}

		files = append(files, fileInfo)
		totalSize += fileInfo.SizeBytes

		if totalSize > importplans.MaxTotalSizeDefault {
			_ = s.imports.Abort(created.ID)
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "total upload exceeds maximum size"})
			return
		}
	}

	if len(files) == 0 {
		_ = s.imports.Abort(created.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "no files uploaded"})
		return
	}

	command := []string{"flow360", "project", "create", "<staged-files>", "--from", sourceType, "--name", name, "--unit", plan.Unit}
	if sourceType == "geometry" && plan.Workflow != "" {
		command = append(command, "--workflow", plan.Workflow)
	}
	if plan.SolverVersion != "" {
		command = append(command, "--solver-version", plan.SolverVersion)
	}
	if plan.FolderID != "" {
		command = append(command, "--folder-id", plan.FolderID)
	}
	for _, tag := range plan.Tags {
		command = append(command, "--tag", tag)
	}

	finalized, err := s.imports.FinalizePlan(created.ID, files, totalSize, command)
	if err != nil {
		_ = s.imports.Abort(created.ID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, finalized)
}

func (s *Server) listImports(c *gin.Context) {
	folderID := strings.TrimSpace(c.Query("folder_id"))
	statusFilter := strings.TrimSpace(c.Query("status"))

	plans, err := s.imports.List(folderID, statusFilter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plans)
}

func (s *Server) getImport(c *gin.Context) {
	plan, err := s.imports.Get(c.Param("import_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plan)
}

func (s *Server) approveImport(c *gin.Context) {
	plan, err := s.imports.Update(c.Param("import_id"), func(plan *importplans.Plan) error {
		if plan.Status != "draft" {
			return fmt.Errorf("only a draft import can be approved")
		}
		if plan.SourceType == "geometry" && !plan.UnitConfirmed {
			return fmt.Errorf("geometry imports require unit confirmation before approval")
		}
		plan.Status = "approved"
		return nil
	})
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plan)
}

func (s *Server) runImport(c *gin.Context) {
	plan, duplicate, err := s.imports.Start(c.Param("import_id"))
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if duplicate != nil {
		c.JSON(http.StatusConflict, gin.H{
			"error":           "identical import is already running or submitted",
			"existing_import": duplicate,
		})
		return
	}

	result, runErr := s.flow360.CreateProject(
		c.Request.Context(),
		s.imports.FilePaths(plan),
		plan.SourceType,
		plan.Name,
		plan.Unit,
		plan.Workflow,
		plan.SolverVersion,
		plan.FolderID,
		plan.Tags,
	)

	plan, _ = s.imports.Update(plan.ID, func(plan *importplans.Plan) error {
		if runErr != nil {
			plan.Status = "failed"
			plan.Error = "Flow360 did not accept the project import"
		} else {
			plan.Status = "submitted"
			plan.Result = result
		}
		return nil
	})

	if runErr != nil {
		log.Printf("Flow360 project import failed: %v", runErr)
		c.JSON(http.StatusBadGateway, plan)
		return
	}

	c.JSON(http.StatusOK, plan)
}

func (s *Server) abortImport(c *gin.Context) {
	err := s.imports.Abort(c.Param("import_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "aborted"})
}

type createPlanRequest struct {
	ProjectID   string          `json:"project_id"`
	ProjectName string          `json:"project_name"`
	SourceID    string          `json:"source_id"`
	SourceType  string          `json:"source_type"`
	SourceName  string          `json:"source_name"`
	Target      string          `json:"target"`
	Name        string          `json:"name"`
	Intent      string          `json:"intent"`
	Patch       json.RawMessage `json:"patch"`
}

func (s *Server) createPlan(c *gin.Context) {
	var request createPlanRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid plan request"})
		return
	}
	detail, err := s.flow360.ResourceDetail(c.Request.Context(), request.SourceType, request.SourceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var info struct {
		ProjectID string `json:"project_id"`
		Name      string `json:"name"`
	}
	if len(detail.Info) == 0 || json.Unmarshal(detail.Info, &info) != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Flow360 source metadata is unavailable"})
		return
	}
	if info.ProjectID != request.ProjectID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source resource does not belong to this project"})
		return
	}
	plan, err := s.plans.Create(plans.CreateInput{
		ProjectID: request.ProjectID, ProjectName: request.ProjectName,
		SourceID: request.SourceID, SourceType: detail.Type, SourceName: info.Name,
		Target: request.Target, Name: request.Name, Intent: request.Intent,
		Patch: request.Patch, Baseline: detail.SimulationParams,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	plan = s.runPlanPreflight(c.Request.Context(), plan)
	c.JSON(http.StatusCreated, plan)
}

func (s *Server) listPlans(c *gin.Context) {
	list, err := s.plans.List(strings.TrimSpace(c.Query("project_id")), strings.TrimSpace(c.Query("source_id")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not list local plans"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"plans": list})
}

func (s *Server) getPlan(c *gin.Context) {
	plan, err := s.plans.Get(c.Param("plan_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plan)
}

func (s *Server) preflightPlan(c *gin.Context) {
	plan, err := s.plans.Get(c.Param("plan_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	plan = s.runPlanPreflight(c.Request.Context(), plan)
	c.JSON(http.StatusOK, plan)
}

type applyPlanInputsRequest struct {
	Revision int             `json:"revision"`
	Values   json.RawMessage `json:"values"`
}

const maxPlanInputsRequestBytes = 300 << 10

func (s *Server) applyPlanInputs(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPlanInputsRequestBytes)
	var request applyPlanInputsRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "dynamic form submission is too large"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dynamic form submission"})
		return
	}
	plan, err := s.plans.Get(c.Param("plan_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if plan.Preflight == nil || plan.Preflight.ValidatedRevision != plan.Revision {
		c.JSON(http.StatusConflict, gin.H{"error": "run Flow360 schema preflight before submitting inputs"})
		return
	}
	if request.Revision != plan.Revision {
		c.JSON(http.StatusConflict, gin.H{"error": "plan revision is stale"})
		return
	}
	if err := plans.ValidateFormValues(plan.Preflight.FormSchema, request.Values); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	updated, err := s.plans.ApplyInputs(plan.ID, request.Revision, request.Values)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	updated = s.runPlanPreflight(c.Request.Context(), updated)
	c.JSON(http.StatusOK, updated)
}

func (s *Server) runPlanPreflight(ctx context.Context, plan plans.Plan) plans.Plan {
	if len(plan.Baseline) == 0 || plan.Revision == 0 {
		detail, err := s.flow360.ResourceDetail(ctx, plan.SourceType, plan.SourceID)
		if err != nil || len(detail.SimulationParams) == 0 {
			return s.persistUnavailablePreflight(plan, "Flow360 source SimulationParams are unavailable")
		}
		updated, err := s.plans.SetBaseline(plan.ID, detail.SimulationParams)
		if err != nil {
			return s.persistUnavailablePreflight(plan, "Could not store the Flow360 SimulationParams baseline")
		}
		plan = updated
	}
	merged, err := plans.MergedSimulationParams(plan)
	if err != nil {
		return s.persistUnavailablePreflight(plan, err.Error())
	}
	result, err := s.flow360.PreflightSimulationParams(ctx, plan.SourceType, plan.Target, merged)
	if err != nil {
		log.Printf("Flow360 schema preflight failed for %s: %v", plan.ID, err)
		return s.persistUnavailablePreflight(plan, "Flow360 schema preflight is temporarily unavailable")
	}
	issues := make([]plans.PreflightIssue, 0, len(result.Issues))
	for _, issue := range result.Issues {
		issues = append(issues, plans.PreflightIssue{
			Level: issue.Level, Code: issue.Code, Path: issue.Path,
			Message: issue.Message, Stages: issue.Stages,
		})
	}
	updated, err := s.plans.SetPreflight(plan.ID, plans.Preflight{
		SchemaVersion: result.SchemaVersion, ValidatorVersion: result.ValidatorVersion,
		Valid: result.Valid, ValidatedRevision: plan.Revision,
		Issues: issues, FormSchema: result.FormSchema,
	})
	if err != nil {
		log.Printf("Could not persist Flow360 schema preflight for %s: %v", plan.ID, err)
		return plan
	}
	return updated
}

func (s *Server) persistUnavailablePreflight(plan plans.Plan, message string) plans.Plan {
	formSchema := json.RawMessage(`{"type":"object","properties":{},"required":[]}`)
	updated, err := s.plans.SetPreflight(plan.ID, plans.Preflight{
		SchemaVersion: 1, Valid: false, ValidatedRevision: plan.Revision,
		Issues: []plans.PreflightIssue{{
			Level: "error", Code: "preflight_unavailable", Message: message,
		}},
		FormSchema: formSchema,
	})
	if err != nil {
		log.Printf("Could not persist unavailable preflight state for %s: %v", plan.ID, err)
		return plan
	}
	return updated
}

func (s *Server) approvePlan(c *gin.Context) {
	plan, err := s.plans.Update(c.Param("plan_id"), func(plan *plans.Plan) error {
		if plan.Status != plans.StatusDraft {
			return fmt.Errorf("only a draft plan can be approved")
		}
		if plan.Preflight == nil || !plan.Preflight.Valid || plan.Preflight.ValidatedRevision != plan.Revision {
			return errors.New(plans.ErrPreflightRequired)
		}
		for _, validation := range plan.Validations {
			if validation.Level == "error" {
				return fmt.Errorf("plan has validation errors")
			}
		}
		now := time.Now().UTC()
		plan.Status = plans.StatusApproved
		plan.ApprovedAt = &now
		return nil
	})
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plan)
}

func (s *Server) runPlan(c *gin.Context) {
	existing, err := s.plans.Get(c.Param("plan_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	existing = s.runPlanPreflight(c.Request.Context(), existing)
	if existing.Preflight == nil || !existing.Preflight.Valid || existing.Preflight.ValidatedRevision != existing.Revision {
		c.JSON(http.StatusUnprocessableEntity, existing)
		return
	}
	if existing.SubmissionID != "" && existing.Status != plans.StatusFailed {
		c.JSON(http.StatusConflict, gin.H{
			"error":       plans.ErrDoubleSubmitProtect,
			"plan_status": existing.Status,
			"submission":  existing.SubmissionID,
		})
		return
	}

	submissionID, err := newSubmissionID()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not generate submission id"})
		return
	}
	plan, err := s.plans.SetRunning(existing.ID, submissionID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	result, runErr := s.flow360.RunDraft(c.Request.Context(), plan.SourceID, plan.Name, plan.Target, plan.Patch)
	if runErr != nil {
		failed, persistErr := s.plans.MarkFailed(plan.ID, publicExecutionError(runErr))
		if persistErr != nil {
			log.Printf("could not persist failed plan state: %v", persistErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not persist execution state"})
			return
		}
		log.Printf("Flow360 plan execution failed: %v", runErr)
		c.JSON(http.StatusBadGateway, failed)
		return
	}

	submitted, persistErr := s.plans.MarkSubmitted(plan.ID, result)
	if persistErr != nil {
		log.Printf("could not persist submitted plan state: %v", persistErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not persist execution state"})
		return
	}
	c.JSON(http.StatusOK, submitted)
}

func publicExecutionError(err error) error {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "fail to generate simulation config"),
		strings.Contains(message, "validation"),
		strings.Contains(message, "bad request"):
		return errors.New("Flow360 validation rejected the simulation configuration. Complete the required schema inputs and validate again")
	case strings.Contains(message, "unauthorized"), strings.Contains(message, "authentication"),
		strings.Contains(message, "401"), strings.Contains(message, "403"):
		return errors.New("Flow360 authentication failed. Check the configured environment and API key")
	case strings.Contains(message, "timeout"), strings.Contains(message, "deadline"):
		return errors.New("Flow360 submission timed out. Check the remote draft state before retrying")
	default:
		return errors.New("Flow360 did not accept this plan. Review the server log for diagnostic details")
	}
}

func newSubmissionID() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "sub-" + hex.EncodeToString(b), nil
}

func (s *Server) flow360ResourceDetail(c *gin.Context) {
	resourceType := c.Param("resource_type")
	resourceID := c.Param("resource_id")
	cacheKey := resourceType + "/" + resourceID
	if strings.EqualFold(c.Query("cache"), "only") {
		s.serveCachedJSON(c, "resource-detail", cacheKey)
		return
	}
	detail, err := s.flow360.ResourceDetail(
		c.Request.Context(),
		resourceType,
		resourceID,
	)
	if err != nil {
		if s.serveCachedJSON(c, "resource-detail", cacheKey) {
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// ResourceDetail is assembled from several Flow360 CLI calls. The client
	// intentionally returns partial data with HTTP success when one or more of
	// those calls fail, so treat that result as degraded: prefer the last
	// complete snapshot and never overwrite it with partial data.
	if len(detail.Errors) > 0 {
		if s.serveCachedJSON(c, "resource-detail", cacheKey) {
			return
		}
		// No snapshot available — the caller cannot trust a partial payload.
		c.JSON(http.StatusBadGateway, gin.H{
			"error":         "Flow360 resource detail is unavailable",
			"partial":       detail,
			"operation_err": detail.Errors,
		})
		return
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not encode resource detail"})
		return
	}
	s.cacheLiveJSON("resource-detail", cacheKey, raw)
	s.writeLiveJSON(c, raw)
}

func (s *Server) flow360ResourceLogs(c *gin.Context) {
	tail, err := strconv.Atoi(c.DefaultQuery("tail", "200"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tail must be an integer"})
		return
	}
	output, err := s.flow360.ResourceLogs(
		c.Request.Context(),
		c.Param("resource_type"),
		c.Param("resource_id"),
		tail,
	)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Flow360 logs are unavailable"})
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", output)
}

func (s *Server) flow360ResourceDownload(c *gin.Context) {
	resultPath := strings.TrimSpace(c.Query("path"))
	if resultPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path query parameter is required"})
		return
	}
	output, contentType, err := s.flow360.ResourceResult(
		c.Request.Context(),
		c.Param("resource_type"),
		c.Param("resource_id"),
		resultPath,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(resultPath)))
	c.Data(http.StatusOK, contentType, output)
}

func (s *Server) flow360ResourcePreview(c *gin.Context) {
	resultPath := strings.TrimSpace(c.Query("path"))
	if resultPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path query parameter is required"})
		return
	}
	output, err := s.flow360.ResourceResultPreview(
		c.Request.Context(),
		c.Param("resource_type"),
		c.Param("resource_id"),
		resultPath,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", output)
}

func (s *Server) flow360ResourceMeshPreview(c *gin.Context) {
	resourceType := c.Param("resource_type")
	resourceID := c.Param("resource_id")

	if err := flow360.ValidateResourcePath(resourceType, resourceID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if resourceType == "Geometry" && s.mirror != nil {
		manifest, manifestErr := s.mirror.GeometryVisualizationManifest(resourceID)
		if manifestErr == nil {
			assetURL := fmt.Sprintf(
				"/api/flow360/resources/Geometry/%s/visualization/manifest.json",
				resourceID,
			)
			preview, previewErr := flow360.GeometryUVFPreview(resourceID, manifest, assetURL)
			if previewErr == nil {
				c.Header("Cache-Control", "private, max-age=60")
				c.JSON(http.StatusOK, preview)
				return
			}
		}
	}

	preview, err := s.flow360.ResourcePreviewManifest(
		c.Request.Context(),
		resourceType,
		resourceID,
	)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":    err.Error(),
			"format":   resourceType,
			"groups":   []any{},
			"warnings": []string{"3D preview data is not available for this resource"},
		})
		return
	}

	c.JSON(http.StatusOK, preview)
}

func (s *Server) flow360ResourceVisualizationAsset(c *gin.Context) {
	resourceType := c.Param("resource_type")
	resourceID := c.Param("resource_id")
	if err := flow360.ValidateResourcePath(resourceType, resourceID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if resourceType != "Geometry" || s.mirror == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "visualization asset is unavailable"})
		return
	}
	relative := strings.TrimPrefix(c.Param("asset_path"), "/")
	payload, err := s.mirror.GeometryVisualizationFile(resourceID, relative)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "visualization asset is unavailable"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	contentType := "application/octet-stream"
	if relative == "manifest.json" {
		contentType = "application/json; charset=utf-8"
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, contentType, payload)
}

func (s *Server) flow360CaseConvergence(c *gin.Context) {
	resourceType := c.Param("resource_type")
	resourceID := c.Param("resource_id")

	if err := flow360.ValidateResourcePath(resourceType, resourceID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if resourceType != "Case" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "convergence assessment is only available for Case resources"})
		return
	}

	workDir := s.workDir
	if workDir == "" {
		workDir = os.TempDir()
	}

	discovery, err := convergence.DiscoverCaseResults(
		c.Request.Context(),
		resourceID,
		s.flow360,
		workDir,
	)
	if err != nil {
		assessment := convergence.NewAssessment(convergence.StatusInsufficientData, "result discovery failed")
		c.JSON(http.StatusOK, gin.H{
			"status":      convergence.StatusInsufficientData,
			"reason":      err.Error(),
			"files":       []any{},
			"assessments": map[string]convergence.Assessment{"overall": assessment},
		})
		return
	}

	overall := discovery.FullAssessment()
	files := make([]any, 0, len(discovery.Files))
	for _, f := range discovery.Files {
		files = append(files, f)
	}

	status := convergence.StatusInsufficientData
	reason := "no assessment available"
	for _, a := range overall {
		if a.Status == convergence.StatusNotConverged {
			status = convergence.StatusNotConverged
			reason = a.Reason
			break
		}
		if a.Status == convergence.StatusConverged {
			if status != convergence.StatusNotConverged {
				status = convergence.StatusConverged
				reason = a.Reason
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      status,
		"reason":      reason,
		"files":       files,
		"assessments": overall,
	})
}

type compareRequest struct {
	CaseIDs  []string `json:"case_ids"`
	Baseline string   `json:"baseline,omitempty"`
	KPIKeys  []string `json:"kpi_keys,omitempty"`
}

func (s *Server) compareCases(c *gin.Context) {
	var req compareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(req.CaseIDs) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least 2 case IDs are required for comparison"})
		return
	}
	if req.Baseline != "" {
		for index, id := range req.CaseIDs {
			if id == req.Baseline {
				req.CaseIDs[0], req.CaseIDs[index] = req.CaseIDs[index], req.CaseIDs[0]
				break
			}
		}
	}

	kpiKeys := req.KPIKeys
	if len(kpiKeys) == 0 {
		kpiKeys = []string{"Cl", "Cd", "Cm"}
	}

	var baseline map[string]interface{}
	var others []map[string]interface{}

	for i, id := range req.CaseIDs {
		resource, err := s.fetchCaseResource(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   fmt.Sprintf("failed to fetch case %s: %s", id, err.Error()),
				"case_id": id,
			})
			return
		}

		params := map[string]interface{}{
			"id":   id,
			"type": resource.Type,
		}

		if name := extractField(resource.Info, "name"); name != "" {
			params["name"] = name
		} else {
			params["name"] = id
		}

		if status := extractField(resource.State, "status"); status != "" {
			params["status"] = status
		} else {
			params["status"] = "unknown"
		}

		if resource.Summary != nil {
			params["summary"] = rawToMap(resource.Summary)
		}
		if resource.SimulationParams != nil {
			params["simulation_params"] = rawToMap(resource.SimulationParams)
		}

		if i == 0 {
			baseline = params
		} else {
			others = append(others, params)
		}
	}

	result := comparison.CompareCases(baseline, others, kpiKeys)
	for i := range result.Cases {
		assessment, assessments := s.caseConvergenceEvidence(c.Request.Context(), result.Cases[i].ID)
		result.Cases[i].Convergence = assessment
		if resultKPIs := kpisFromConvergence(assessments, kpiKeys, assessment.Status == convergence.StatusConverged); len(resultKPIs) > 0 {
			result.Cases[i].KPIs = resultKPIs
		}
		for j := range result.Cases[i].KPIs {
			result.Cases[i].KPIs[j].Converged = assessment.Status == convergence.StatusConverged
		}
	}
	result.Ranking = comparison.RankCases(result.Cases)

	c.JSON(http.StatusOK, result)
}

func (s *Server) caseConvergenceEvidence(ctx context.Context, caseID string) (convergence.Assessment, map[string]convergence.Assessment) {
	discovery, err := convergence.DiscoverCaseResults(ctx, caseID, s.flow360, s.workDir)
	if err != nil {
		return convergence.NewAssessment(convergence.StatusInsufficientData, err.Error()), nil
	}
	assessments := discovery.FullAssessment()
	combined := convergence.NewAssessment(convergence.StatusInsufficientData, "no convergence evidence available")
	for _, kind := range []string{"forces", "residuals", "overall"} {
		assessment, ok := assessments[kind]
		if !ok {
			continue
		}
		if assessment.Status == convergence.StatusNotConverged {
			return assessment, assessments
		}
		if assessment.Status == convergence.StatusConverged {
			combined = assessment
			continue
		}
		if combined.Reason == "no convergence evidence available" {
			combined = assessment
		}
	}
	return combined, assessments
}

func kpisFromConvergence(assessments map[string]convergence.Assessment, keys []string, converged bool) []comparison.KPIData {
	forceAssessment, ok := assessments["forces"]
	if !ok {
		return nil
	}
	metricsByName := make(map[string]convergence.Metric, len(forceAssessment.Metrics))
	for name, metric := range forceAssessment.Metrics {
		metricsByName[normalizeKPIName(name)] = metric
	}
	result := make([]comparison.KPIData, 0, len(keys))
	for _, key := range keys {
		metric, exists := metricsByName[normalizeKPIName(key)]
		if !exists {
			continue
		}
		result = append(result, comparison.KPIData{
			Name:      key,
			Value:     metric.Final,
			Converged: converged,
			Source:    "Flow360 total forces history",
		})
	}
	return result
}

func normalizeKPIName(value string) string {
	var result strings.Builder
	for _, r := range strings.ToLower(value) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			result.WriteRune(r)
		}
	}
	return result.String()
}

type sweepRequest struct {
	BaselineCaseID string                      `json:"baseline_case_id"`
	ProjectID      string                      `json:"project_id"`
	ProjectName    string                      `json:"project_name,omitempty"`
	BaselineName   string                      `json:"baseline_name,omitempty"`
	Parameters     []comparison.SweepParameter `json:"parameters"`
	CreatePlans    bool                        `json:"create_plans,omitempty"`
	Confirmed      bool                        `json:"confirmed,omitempty"`
}

func (s *Server) generateSweepPlan(c *gin.Context) {
	var req sweepRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.BaselineCaseID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "baseline_case_id is required"})
		return
	}

	plan := comparison.GenerateSweepPlan(req.BaselineCaseID, req.Parameters)

	warnings := comparison.ValidateSweepPlan(plan)
	if !req.CreatePlans {
		c.JSON(http.StatusOK, gin.H{"plan": plan, "warnings": warnings, "plans": []any{}})
		return
	}
	if !req.Confirmed {
		c.JSON(http.StatusConflict, gin.H{"error": "explicit sweep plan confirmation is required"})
		return
	}
	if plan.OverBudget || plan.TotalCases == 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "sweep size is not executable", "plan": plan, "warnings": warnings})
		return
	}
	if strings.TrimSpace(req.ProjectID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_id is required when creating sweep plans"})
		return
	}
	baseline, err := s.flow360.ResourceDetail(c.Request.Context(), "Case", req.BaselineCaseID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "baseline Case is unavailable"})
		return
	}
	created := make([]plans.Plan, 0, plan.TotalCases)
	for index, combination := range plan.Combinations {
		patch := sweepPatch(plan.Parameters, combination)
		patchRaw, _ := json.Marshal(patch)
		keyRaw, _ := json.Marshal(struct {
			CaseID string
			Params []comparison.SweepParameter
			Values []float64
		}{req.BaselineCaseID, plan.Parameters, combination})
		key := fmt.Sprintf("sweep-%x", sha256.Sum256(keyRaw))
		createdPlan, createErr := s.plans.Create(plans.CreateInput{
			ProjectID:      req.ProjectID,
			ProjectName:    req.ProjectName,
			SourceID:       req.BaselineCaseID,
			SourceType:     "Case",
			SourceName:     req.BaselineName,
			Target:         "case",
			Name:           fmt.Sprintf("%s sweep %02d", firstNonEmpty(req.BaselineName, "Case"), index+1),
			Intent:         "Reviewed parameter sweep: " + comparison.FormatCombination(plan.Parameters, combination),
			Patch:          patchRaw,
			Baseline:       baseline.SimulationParams,
			IdempotencyKey: key,
		})
		if createErr != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": createErr.Error(), "plan": plan, "warnings": warnings, "plans": created})
			return
		}
		created = append(created, createdPlan)
	}
	c.JSON(http.StatusOK, gin.H{"plan": plan, "warnings": warnings, "plans": created})
}

func sweepPatch(parameters []comparison.SweepParameter, values []float64) map[string]any {
	root := map[string]any{}
	for i, parameter := range parameters {
		if i >= len(values) {
			break
		}
		segments := strings.Split(strings.Trim(parameter.Name, "."), ".")
		current := root
		for j, segment := range segments {
			if segment == "" {
				continue
			}
			if j == len(segments)-1 {
				current[segment] = values[i]
				continue
			}
			next, ok := current[segment].(map[string]any)
			if !ok {
				next = map[string]any{}
				current[segment] = next
			}
			current = next
		}
	}
	return root
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (s *Server) fetchCaseResource(ctx context.Context, caseID string) (flow360.ResourceDetail, error) {
	if err := flow360.ValidateResourcePath("Case", caseID); err != nil {
		return flow360.ResourceDetail{}, err
	}
	return s.flow360.ResourceDetail(ctx, "Case", caseID)
}

func rawToMap(raw json.RawMessage) map[string]interface{} {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return m
}

func extractField(raw json.RawMessage, field string) string {
	m := rawToMap(raw)
	if m == nil {
		return ""
	}
	if val, ok := m[field]; ok {
		if s, ok := val.(string); ok {
			return s
		}
	}
	return ""
}

func (s *Server) flow360Status(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	c.JSON(http.StatusOK, s.flow360.Status(ctx))
}

func (s *Server) flow360Projects(c *gin.Context) {
	folderID := strings.TrimSpace(c.Query("folder_id"))
	cacheKey := "all"
	cacheKind := "project-list"
	if folderID != "" {
		cacheKey = folderID
		cacheKind = "folder-projects"
	}
	if strings.EqualFold(c.Query("cache"), "only") {
		s.serveCachedJSON(c, cacheKind, cacheKey)
		return
	}
	raw, err := s.flow360.Projects(c.Request.Context(), 25, folderID)
	if err != nil {
		log.Printf("Flow360 project listing unavailable: %v", err)
		if s.serveCachedJSON(c, cacheKind, cacheKey) {
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"projects":  []any{},
			"warning":   "Flow360 project listing is temporarily unavailable",
			"folder_id": folderID,
		})
		return
	}
	s.cacheLiveJSON(cacheKind, cacheKey, raw)
	s.writeLiveJSON(c, raw)
}

func (s *Server) flow360ProjectInfo(c *gin.Context) {
	s.flow360ProjectJSON(c, "project-info", s.flow360.ProjectInfo)
}

func (s *Server) flow360ProjectTree(c *gin.Context) {
	s.flow360ProjectJSON(c, "project-tree", s.flow360.ProjectTree)
}

func (s *Server) flow360ProjectItems(c *gin.Context) {
	s.flow360ProjectJSON(c, "project-items", s.flow360.ProjectItems)
}

func (s *Server) flow360ProjectJSON(
	c *gin.Context,
	kind string,
	load func(context.Context, string) (json.RawMessage, error),
) {
	projectID := strings.TrimSpace(c.Param("project_id"))
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_id is required"})
		return
	}
	if strings.EqualFold(c.Query("cache"), "only") {
		s.serveCachedJSON(c, kind, projectID)
		return
	}
	raw, err := load(c.Request.Context(), projectID)
	if err != nil {
		log.Printf("Flow360 project resource unavailable: %v", err)
		if s.serveCachedJSON(c, kind, projectID) {
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Flow360 project resource is unavailable"})
		return
	}
	s.cacheLiveJSON(kind, projectID, raw)
	s.writeLiveJSON(c, raw)
}

func (s *Server) cacheLiveJSON(kind, key string, raw json.RawMessage) {
	if !cacheableSnapshot(kind, raw) {
		log.Printf("Skipped incomplete Flow360 %s snapshot for %q", kind, key)
		return
	}
	if _, err := s.cache.Put(kind, key, raw); err != nil {
		log.Printf("Could not cache Flow360 %s %q: %v", kind, key, err)
	}
}

func cacheableSnapshot(kind string, raw json.RawMessage) bool {
	if !json.Valid(raw) {
		return false
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return false
	}
	switch kind {
	case "folder-tree", "project-tree":
		root, ok := payload["root"].(map[string]any)
		id, hasID := root["id"].(string)
		return ok && hasID && strings.TrimSpace(id) != ""
	case "project-list", "folder-projects":
		for _, key := range []string{"records", "projects"} {
			if records, ok := payload[key].([]any); ok {
				return len(records) > 0
			}
		}
		return false
	case "project-items":
		_, ok := payload["items"].([]any)
		return ok
	case "project-info", "resource-detail":
		id, ok := payload["id"].(string)
		return ok && strings.TrimSpace(id) != ""
	default:
		return false
	}
}

func (s *Server) serveCachedJSON(c *gin.Context, kind, key string) bool {
	entry, err := s.cache.Get(kind, key)
	if err != nil {
		if strings.EqualFold(c.Query("cache"), "only") {
			c.JSON(http.StatusNotFound, gin.H{"error": "local snapshot is unavailable"})
			return true
		}
		return false
	}
	c.Header("X-VibeSim-Data-Source", "cache")
	c.Header("X-VibeSim-Cached-At", entry.CachedAt.Format(time.RFC3339Nano))
	if time.Since(entry.CachedAt) > projectcache.DefaultTTL {
		c.Header("X-VibeSim-Cache-Stale", "true")
	}
	c.Header("Warning", `110 - "Response is a cached Flow360 snapshot"`)
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/json; charset=utf-8", entry.Data)
	return true
}

func (s *Server) writeLiveJSON(c *gin.Context, raw json.RawMessage) {
	c.Header("X-VibeSim-Data-Source", "live")
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/json; charset=utf-8", raw)
}

func cacheNamespace(environment, profile string) string {
	environment = strings.ToLower(strings.TrimSpace(environment))
	profile = strings.ToLower(strings.TrimSpace(profile))
	if environment == "" {
		environment = "production"
	}
	if profile == "" {
		profile = "default"
	}
	value := environment + "-" + profile
	var result strings.Builder
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z', char >= '0' && char <= '9', char == '-', char == '_':
			result.WriteRune(char)
		default:
			result.WriteByte('-')
		}
	}
	return strings.Trim(result.String(), "-")
}

func (s *Server) flow360Folders(c *gin.Context) {
	if strings.EqualFold(c.Query("cache"), "only") {
		s.serveCachedJSON(c, "folder-tree", "root")
		return
	}
	raw, err := s.flow360.Folders(c.Request.Context())
	if err != nil {
		log.Printf("Flow360 folder tree unavailable: %v", err)
		if s.serveCachedJSON(c, "folder-tree", "root") {
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Flow360 folder tree is unavailable"})
		return
	}
	s.cacheLiveJSON("folder-tree", "root", raw)
	s.writeLiveJSON(c, raw)
}

func (s *Server) chatStream(c *gin.Context) {
	var request agent.ChatRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming is unavailable"})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	writeEvent(c.Writer, flusher, gin.H{"type": "start"})

	reply, err := s.agent.Chat(c.Request.Context(), request)
	if err != nil {
		writeEvent(c.Writer, flusher, gin.H{"type": "error", "error": err.Error()})
		return
	}

	scanner := bufio.NewScanner(strings.NewReader(reply))
	scanner.Split(scanWordsWithWhitespace)
	for scanner.Scan() {
		writeEvent(c.Writer, flusher, gin.H{"type": "delta", "delta": scanner.Text()})
	}
	writeEvent(c.Writer, flusher, gin.H{"type": "done"})
}

type actionPlanRequest struct {
	Action agent.Action `json:"action"`
}

func (s *Server) planFromAction(c *gin.Context) {
	var req actionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if req.Action.Kind != agent.ActionCreatePlan {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unsupported action kind: %s", req.Action.Kind)})
		return
	}
	if len(req.Action.Proposals) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no proposals to convert"})
		return
	}
	results := make([]map[string]any, 0, len(req.Action.Proposals))
	for _, p := range req.Action.Proposals {
		planInput := plans.CreateInput{
			ProjectID:   p.ProjectID,
			ProjectName: p.ProjectName,
			SourceID:    p.SourceID,
			SourceType:  p.SourceType,
			SourceName:  p.SourceName,
			Target:      p.Target,
			Name:        p.Name,
			Intent:      p.Intent,
			Patch:       p.Patch,
		}
		plan, err := s.plans.Create(planInput)
		if err != nil {
			results = append(results, map[string]any{
				"id":    p.ID,
				"error": err.Error(),
			})
			continue
		}
		results = append(results, map[string]any{
			"id":     p.ID,
			"plan":   plan,
			"status": plan.Status,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"message":  req.Action.Message,
		"warnings": req.Action.Warnings,
		"results":  results,
		"total":    len(results),
		"created":  countSuccesses(results),
		"failed":   len(results) - countSuccesses(results),
	})
}

func countSuccesses(results []map[string]any) int {
	n := 0
	for _, r := range results {
		if _, ok := r["plan"]; ok {
			n++
		}
	}
	return n
}

func writeEvent(w http.ResponseWriter, flusher http.Flusher, value any) {
	data, _ := json.Marshal(value)
	_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}

func scanWordsWithWhitespace(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	for index := 0; index < len(data); {
		r, size := utf8.DecodeRune(data[index:])
		index += size
		if r == ' ' || r == '\n' || r == '\t' {
			for index < len(data) {
				next, nextSize := utf8.DecodeRune(data[index:])
				if next != ' ' && next != '\n' && next != '\t' {
					break
				}
				index += nextSize
			}
			return index, data[:index], nil
		}
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}
