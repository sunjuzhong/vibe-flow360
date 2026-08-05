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
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
	"github.com/sunjuzhong/vibe-flow360/internal/annotations"
	"github.com/sunjuzhong/vibe-flow360/internal/comparison"
	"github.com/sunjuzhong/vibe-flow360/internal/convergence"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/geometrydiag"
	importplans "github.com/sunjuzhong/vibe-flow360/internal/imports"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
	"github.com/sunjuzhong/vibe-flow360/internal/projectcache"
	"github.com/sunjuzhong/vibe-flow360/internal/projectmirror"
)

//go:embed dist
var webFS embed.FS

type Server struct {
	router             *gin.Engine
	flow360            *flow360.Client
	agent              *agent.Service
	chatSessions       *agent.ChatStore
	cadGenerator       aicreate.Generator
	plans              *plans.Store
	imports            *importplans.Store
	cache              *projectcache.Store
	mirror             *projectmirror.Store
	interventions      *agent.InterventionStore
	interventionEngine *agent.Engine
	workDir            string

	projectSyncClient  projectSyncClient
	projectSyncMu      sync.Mutex
	projectSyncJobs    map[string]struct{}
	geometryDiagMu     sync.Mutex
	geometryDiagCache  map[string]geometryDiagnosticsCacheEntry
	geometryJobs       *geometrydiag.JobStore
	geometryJobSlots   chan struct{}
	annotationHandlers *AnnotationHandlers
	aiCreateMu         sync.Mutex
	aiCreateSessions   map[string]aiCreateSession
}

type geometryDiagnosticsCacheEntry struct {
	Report    geometrydiag.Report
	CreatedAt time.Time
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
	geometryJobStore, err := geometrydiag.NewJobStore(filepath.Join(dataDir, "geometry-diagnostics"))
	if err != nil {
		panic(err)
	}
	annotationStore, err := annotations.NewStore(filepath.Join(
		dataDir,
		"annotations",
		cacheNamespace(flowClient.Environment, flowClient.Profile),
	))
	if err != nil {
		panic(err)
	}

	interventionStore, err := agent.NewInterventionStore(filepath.Join(dataDir, "interventions"))
	if err != nil {
		panic(err)
	}
	aiService := agent.NewService()
	chatStore, err := agent.NewChatStore(filepath.Join(dataDir, "chat-sessions"))
	if err != nil {
		panic(err)
	}
	interventionEngine := agent.NewEngine(interventionStore, planStore, aiService)

	app := &Server{
		router:             router,
		flow360:            flowClient,
		agent:              aiService,
		chatSessions:       chatStore,
		cadGenerator:       aicreate.NewCadQueryGenerator(),
		plans:              planStore,
		imports:            importStore,
		cache:              cacheStore,
		mirror:             mirrorStore,
		interventions:      interventionStore,
		interventionEngine: interventionEngine,
		workDir:            dataDir,
		projectSyncClient:  flowClient,
		projectSyncJobs:    map[string]struct{}{},
		geometryDiagCache:  map[string]geometryDiagnosticsCacheEntry{},
		geometryJobs:       geometryJobStore,
		geometryJobSlots:   make(chan struct{}, 2),
		annotationHandlers: NewAnnotationHandlers(annotationStore),
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
		if plan.Status == plans.StatusSubmitted {
			s.startPlanMonitor(plan)
			continue
		}
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
		submitted, err := s.plans.MarkSubmitted(plan.ID, result)
		if err != nil {
			log.Printf("Could not persist reconciled plan %s: %v", plan.ID, err)
			continue
		}
		s.startPlanMonitor(submitted)
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
		s.annotationHandlers.RegisterRoutes(api)
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"ok": true, "service": "vibe-flow360"})
		})
		api.GET("/flow360/status", s.flow360Status)
		api.GET("/flow360/projects", s.flow360Projects)
		api.GET("/flow360/folders", s.flow360Folders)
		api.POST("/flow360/folders", s.createFlow360Folder)
		api.PUT("/flow360/folders/:folder_id/name", s.renameFlow360Folder)
		api.PUT("/flow360/folders/:folder_id/parent", s.moveFlow360Folder)
		api.DELETE("/flow360/folders/:folder_id", s.deleteFlow360Folder)
		api.GET("/flow360/projects/:project_id", s.flow360ProjectInfo)
		api.PUT("/flow360/projects/:project_id/name", s.renameFlow360Project)
		api.DELETE("/flow360/projects/:project_id", s.deleteFlow360Project)
		api.GET("/flow360/projects/:project_id/tree", s.flow360ProjectTree)
		api.GET("/flow360/projects/:project_id/items", s.flow360ProjectItems)
		api.GET("/flow360/projects/:project_id/drafts", s.flow360ProjectDrafts)
		api.GET("/flow360/drafts/:draft_id/parameters/schema", s.flow360DraftParameterSchema)
		api.PUT("/flow360/drafts/:draft_id/parameters", s.updateFlow360DraftParameters)
		api.GET("/flow360/projects/:project_id/sync", s.projectSyncStatus)
		api.POST("/flow360/projects/:project_id/sync", s.startProjectSync)
		api.GET("/flow360/resources/:resource_type/:resource_id", s.flow360ResourceDetail)
		// Geometry has static child routes below. Gin's radix router selects the
		// static branch before :resource_type and does not fall back to the
		// wildcard leaf, so register the Geometry detail leaf explicitly.
		api.GET("/flow360/resources/Geometry/:resource_id", s.flow360ResourceDetail)
		api.GET("/flow360/resources/:resource_type/:resource_id/logs", s.flow360ResourceLogs)
		api.GET("/flow360/resources/:resource_type/:resource_id/download", s.flow360ResourceDownload)
		api.GET("/flow360/resources/:resource_type/:resource_id/preview", s.flow360ResourcePreview)
		api.GET("/flow360/resources/:resource_type/:resource_id/preview-mesh", s.flow360ResourceMeshPreview)
		api.GET("/flow360/resources/Geometry/:resource_id/diagnostics", s.flow360GeometryDiagnostics)
		api.POST("/flow360/resources/Geometry/:resource_id/diagnostics/jobs", s.startGeometryDiagnosticsJob)
		api.GET("/flow360/resources/Geometry/:resource_id/diagnostics/jobs/:job_id", s.getGeometryDiagnosticsJob)
		api.DELETE("/flow360/resources/Geometry/:resource_id/diagnostics/jobs/:job_id", s.cancelGeometryDiagnosticsJob)
		api.GET("/flow360/resources/Geometry/:resource_id/compare/:compare_id", s.flow360GeometryComparison)
		api.GET("/flow360/resources/:resource_type/:resource_id/visualization/*asset_path", s.flow360ResourceVisualizationAsset)
		api.GET("/flow360/resources/:resource_type/:resource_id/convergence", s.flow360CaseConvergence)
		api.POST("/flow360/compare", s.compareCases)
		api.POST("/flow360/sweep", s.generateSweepPlan)
		api.GET("/plans", s.listPlans)
		api.POST("/plans", s.createPlan)
		api.POST("/plans/form-schema", s.planFormSchema)
		api.POST("/plans/assist", s.assistPlanForm)
		api.GET("/plans/:plan_id", s.getPlan)
		api.GET("/plans/:plan_id/execution", s.planExecution)
		api.POST("/plans/:plan_id/preflight", s.preflightPlan)
		api.POST("/plans/:plan_id/inputs", s.applyPlanInputs)
		api.POST("/plans/:plan_id/recover", s.recoverPlan)
		api.POST("/plans/:plan_id/approve", s.approvePlan)
		api.POST("/plans/:plan_id/run", s.runPlan)
		api.POST("/imports", s.stageImport)
		api.GET("/imports", s.listImports)
		api.GET("/imports/:import_id", s.getImport)
		api.POST("/imports/:import_id/approve", s.approveImport)
		api.POST("/imports/:import_id/run", s.runImport)
		api.DELETE("/imports/:import_id", s.abortImport)
		api.POST("/ai-create", s.aiCreateProject)
		api.GET("/agent/state", func(c *gin.Context) {
			c.JSON(http.StatusOK, s.agent.State())
		})
		api.GET("/agent/chat/session", s.getChatSession)
		api.POST("/agent/chat/stream", s.chatStream)
		api.POST("/agent/plan-from-action", s.planFromAction)
		api.GET("/interventions", s.listInterventions)
		api.GET("/interventions/:intervention_id", s.getIntervention)
		api.POST("/interventions", s.createIntervention)
		api.POST("/interventions/:intervention_id/diagnose", s.runInterventionDiagnosis)
		api.POST("/interventions/:intervention_id/proposals", s.generateInterventionProposals)
		api.POST("/interventions/:intervention_id/answers", s.submitInterventionAnswers)
		api.POST("/interventions/:intervention_id/select", s.selectInterventionProposal)
		api.POST("/interventions/:intervention_id/compile", s.compileInterventionPatch)
		api.POST("/interventions/:intervention_id/validate", s.validateIntervention)
		api.POST("/interventions/:intervention_id/complete", s.completeInterventionValidation)
		api.POST("/interventions/:intervention_id/close", s.closeIntervention)
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
	if !importplans.IsSupportedLengthUnit(unit) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported length unit; choose m, mm, cm, or inch"})
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
		Name:       name,
		SourceType: sourceType,
		Unit:       unit,
		// A canonical value from the controlled unit selector is the confirmation.
		// Keep this field true for persisted-plan compatibility without requiring a
		// second checkbox from the user.
		UnitConfirmed: true,
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
		if !importplans.IsSupportedLengthUnit(plan.Unit) {
			return fmt.Errorf("import has an unsupported length unit")
		}
		plan.UnitConfirmed = true
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
	if runErr == nil {
		result, runErr = normalizeImportResult(result, plan.SourceType)
	}

	updatedPlan, _ := s.imports.Update(plan.ID, func(plan *importplans.Plan) error {
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
		c.JSON(http.StatusBadGateway, updatedPlan)
		return
	}

	c.JSON(http.StatusOK, updatedPlan)
}

func normalizeImportResult(raw json.RawMessage, sourceType string) (json.RawMessage, error) {
	var data any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, errors.New("Flow360 import returned invalid JSON")
	}
	projectID := findStringField(data, map[string]bool{
		"project_id": true, "projectid": true,
	})
	if projectID == "" {
		projectID = findTypedResourceID(data, "project")
	}
	if projectID == "" {
		return nil, errors.New("Flow360 import did not return a Project ID")
	}

	normalizedType := strings.ReplaceAll(strings.ToLower(sourceType), "-", "")
	rootKeys := map[string]bool{"root_resource_id": true, "resource_id": true}
	switch normalizedType {
	case "geometry":
		rootKeys["geometry_id"] = true
	case "surfacemesh":
		rootKeys["surface_mesh_id"] = true
		rootKeys["surfacemesh_id"] = true
	case "volumemesh":
		rootKeys["volume_mesh_id"] = true
		rootKeys["volumemesh_id"] = true
	}
	rootID := findStringField(data, rootKeys)
	if rootID == "" {
		rootID = findTypedResourceID(data, normalizedType)
	}
	if rootID == "" {
		return nil, errors.New("Flow360 import did not return the root resource ID")
	}

	result := map[string]any{
		"project_id":         projectID,
		"root_resource_id":   rootID,
		"root_resource_type": sourceType,
		"flow360_result":     data,
	}
	return json.Marshal(result)
}

func findStringField(value any, keys map[string]bool) string {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
			if keys[normalized] {
				if result, ok := child.(string); ok && strings.TrimSpace(result) != "" {
					return result
				}
			}
		}
		for _, child := range typed {
			if result := findStringField(child, keys); result != "" {
				return result
			}
		}
	case []any:
		for _, child := range typed {
			if result := findStringField(child, keys); result != "" {
				return result
			}
		}
	}
	return ""
}

func findTypedResourceID(value any, expectedType string) string {
	expectedType = strings.ReplaceAll(strings.ToLower(expectedType), "-", "")
	switch typed := value.(type) {
	case map[string]any:
		resourceType, _ := typed["type"].(string)
		if resourceType == "" {
			resourceType, _ = typed["resource_type"].(string)
		}
		normalizedType := strings.ReplaceAll(strings.ToLower(resourceType), "-", "")
		if normalizedType == expectedType {
			if id, ok := typed["id"].(string); ok && id != "" {
				return id
			}
		}
		for _, child := range typed {
			if result := findTypedResourceID(child, expectedType); result != "" {
				return result
			}
		}
	case []any:
		for _, child := range typed {
			if result := findTypedResourceID(child, expectedType); result != "" {
				return result
			}
		}
	}
	return ""
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
	current, err := plans.MergedSimulationParams(plan)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	expanded, err := plans.ExpandFormValues(plan.Preflight.FormSchema, request.Values, current)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	updated, err := s.plans.ApplySchemaInputs(plan.ID, request.Revision, expanded)
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
			result := s.persistUnavailablePreflight(plan, "Flow360 source SimulationParams are unavailable")
			s.autoCreateInterventionForPreflight(ctx, result)
			return result
		}
		updated, err := s.plans.SetBaseline(plan.ID, detail.SimulationParams)
		if err != nil {
			result := s.persistUnavailablePreflight(plan, "Could not store the Flow360 SimulationParams baseline")
			s.autoCreateInterventionForPreflight(ctx, result)
			return result
		}
		plan = updated
	}
	merged, err := plans.MergedSimulationParams(plan)
	if err != nil {
		result := s.persistUnavailablePreflight(plan, err.Error())
		s.autoCreateInterventionForPreflight(ctx, result)
		return result
	}
	result, err := s.flow360.PreflightSimulationParams(ctx, plan.SourceType, plan.Target, merged)
	if err != nil {
		log.Printf("Flow360 schema preflight failed for %s: %v", plan.ID, err)
		result := s.persistUnavailablePreflight(plan, "Flow360 schema preflight is temporarily unavailable")
		s.autoCreateInterventionForPreflight(ctx, result)
		return result
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
	if !result.Valid && len(issues) > 0 {
		s.autoCreateInterventionForPreflight(ctx, updated)
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

	result, runErr := s.submitPlanToFlow360(c.Request.Context(), plan)
	if runErr != nil {
		failed, persistErr := s.plans.MarkFailed(plan.ID, publicExecutionError(runErr))
		if persistErr != nil {
			log.Printf("could not persist failed plan state: %v", persistErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not persist execution state"})
			return
		}
		log.Printf("Flow360 plan execution failed: %v", runErr)
		s.autoCreateInterventionForRunError(c.Request.Context(), failed, runErr)
		c.JSON(http.StatusBadGateway, failed)
		return
	}

	submitted, persistErr := s.plans.MarkSubmitted(plan.ID, result)
	if persistErr != nil {
		log.Printf("could not persist submitted plan state: %v", persistErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not persist execution state"})
		return
	}

	s.startPlanMonitor(submitted)

	c.JSON(http.StatusOK, submitted)
}

func (s *Server) submitPlanToFlow360(ctx context.Context, plan plans.Plan) (json.RawMessage, error) {
	if plan.RemoteIDs == nil || strings.TrimSpace(plan.RemoteIDs.DraftID) == "" {
		return s.flow360.RunDraft(ctx, plan.SourceID, plan.Name, plan.Target, plan.Patch)
	}
	merged, err := plans.MergedSimulationParams(plan)
	if err != nil {
		return nil, err
	}
	if _, err := s.flow360.SetDraftSimulationParams(ctx, plan.RemoteIDs.DraftID, merged); err != nil {
		return nil, err
	}
	return s.flow360.RunExistingDraft(ctx, plan.RemoteIDs.DraftID, plan.Target)
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

func (s *Server) autoCreateInterventionForPreflight(ctx context.Context, plan plans.Plan) {
	if plan.Preflight == nil || plan.Preflight.Valid {
		return
	}
	if s.interventions == nil || s.interventionEngine == nil {
		return
	}
	existing, _ := s.interventions.List(plan.ProjectID, "", "")
	for _, inv := range existing {
		if inv.PlanID == plan.ID && inv.PlanRevision == plan.Revision &&
			inv.State != agent.InterventionResolved && inv.State != agent.InterventionClosed {
			return
		}
	}
	intervention, err := s.interventionEngine.CreateFromPreflightError(plan)
	if err != nil {
		log.Printf("Could not auto-create intervention for preflight failure on plan %s: %v", plan.ID, err)
		return
	}
	log.Printf("Auto-created intervention %s for preflight failure on plan %s", intervention.ID, plan.ID)
	go s.runInterventionAutoCycle(intervention.ID)
}

func (s *Server) recoverPlan(c *gin.Context) {
	if s.interventions == nil || s.interventionEngine == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Agent recovery is unavailable"})
		return
	}
	plan, err := s.plans.Get(c.Param("plan_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	existing, err := s.interventions.List(plan.ProjectID, "", "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for _, intervention := range existing {
		if intervention.PlanID == plan.ID && intervention.PlanRevision == plan.Revision &&
			intervention.State != agent.InterventionResolved && intervention.State != agent.InterventionClosed {
			c.JSON(http.StatusOK, intervention)
			return
		}
	}
	if plan.Preflight == nil || plan.Preflight.Valid {
		c.JSON(http.StatusConflict, gin.H{"error": "This plan has no unresolved preflight error"})
		return
	}
	intervention, err := s.interventionEngine.CreateFromPreflightError(plan)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	go s.runInterventionAutoCycle(intervention.ID)
	c.JSON(http.StatusCreated, intervention)
}

func (s *Server) autoCreateInterventionForRunError(ctx context.Context, plan plans.Plan, runErr error) {
	if s.interventions == nil || s.interventionEngine == nil {
		return
	}
	existing, _ := s.interventions.List(plan.ProjectID, "", "")
	for _, inv := range existing {
		if inv.PlanID == plan.ID && inv.PlanRevision == plan.Revision &&
			inv.State != agent.InterventionResolved && inv.State != agent.InterventionClosed {
			return
		}
	}
	intervention, err := s.interventionEngine.CreateFromRunError(plan, runErr)
	if err != nil {
		log.Printf("Could not auto-create intervention for run failure on plan %s: %v", plan.ID, err)
		return
	}
	log.Printf("Auto-created intervention %s for run failure on plan %s", intervention.ID, plan.ID)
	go s.runInterventionAutoCycle(intervention.ID)
}

func (s *Server) runInterventionAutoCycle(interventionID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	const maxRetries = 3
	retryCount := 0

	for {
		select {
		case <-ctx.Done():
			log.Printf("Auto-cycle timed out for intervention %s at state", interventionID)
			return
		default:
		}

		intervention, err := s.interventionEngine.RunEngineStep(interventionID)
		if err != nil {
			log.Printf("Auto-cycle step failed for intervention %s: %v", interventionID, err)
			return
		}

		if !intervention.IsActive() {
			log.Printf("Auto-cycle completed for intervention %s at state %s", interventionID, intervention.State)
			return
		}

		switch intervention.State {
		case agent.InterventionProposal, agent.InterventionMissingInput:
			return
		case agent.InterventionUserFeedback:
			intervention, err = s.interventionEngine.RunEngineStep(interventionID)
			if err != nil {
				log.Printf("Auto-cycle step failed for intervention %s: %v", interventionID, err)
				return
			}
		case agent.InterventionValidation:
			intervention, err = s.validateAndApplyIntervention(interventionID)
			if err != nil {
				log.Printf("Auto-cycle validation failed for intervention %s: %v", interventionID, err)
				return
			}
			if intervention.State == agent.InterventionResolved {
				return
			}
			retryCount++
			if retryCount >= maxRetries {
				log.Printf("Auto-cycle max retries reached for intervention %s", interventionID)
				return
			}
			log.Printf("Auto-cycle validation failed for intervention %s (retry %d/%d), retrying from observation",
				interventionID, retryCount, maxRetries)
			continue
		}

		time.Sleep(500 * time.Millisecond)
	}
}

func (s *Server) validateAndApplyIntervention(interventionID string) (agent.Intervention, error) {
	intervention, err := s.interventionEngine.Get(interventionID)
	if err != nil {
		return agent.Intervention{}, err
	}
	if intervention.State != agent.InterventionValidation {
		return agent.Intervention{}, errors.New("intervention is not ready for Flow360 validation")
	}
	if intervention.SelectedProposal == nil || len(intervention.CompiledPatch) == 0 {
		return agent.Intervention{}, errors.New("no compiled patch to validate")
	}
	plan, err := s.plans.Get(intervention.PlanID)
	if err != nil {
		return agent.Intervention{}, fmt.Errorf("plan not found: %w", err)
	}

	var updated plans.Plan
	if plan.Preflight != nil && len(plan.Preflight.FormSchema) > 0 &&
		plans.ValidateFormValues(plan.Preflight.FormSchema, intervention.CompiledPatch) == nil {
		current, mergeErr := plans.MergedSimulationParams(plan)
		if mergeErr != nil {
			return agent.Intervention{}, mergeErr
		}
		expanded, expandErr := plans.ExpandFormValues(
			plan.Preflight.FormSchema,
			intervention.CompiledPatch,
			current,
		)
		if expandErr != nil {
			return agent.Intervention{}, expandErr
		}
		updated, err = s.plans.ApplySchemaInputs(plan.ID, plan.Revision, expanded)
	} else {
		updated, err = s.plans.ApplyInputs(plan.ID, plan.Revision, intervention.CompiledPatch)
	}
	if err != nil {
		return agent.Intervention{}, fmt.Errorf("apply intervention patch: %w", err)
	}
	if _, err := s.interventionEngine.UpdatePlanContext(
		intervention.ID,
		updated.Revision,
		updated.Patch,
	); err != nil {
		return agent.Intervention{}, err
	}
	updated = s.runPlanPreflight(context.Background(), updated)

	var errors []string
	if updated.Preflight == nil {
		errors = append(errors, "Flow360 preflight result is unavailable")
	} else {
		for _, issue := range updated.Preflight.Issues {
			if issue.Level == "error" {
				errors = append(errors, issue.Message)
			}
		}
	}
	result := agent.ValidationResult{
		Valid:       updated.Preflight != nil && updated.Preflight.Valid && len(errors) == 0,
		Errors:      errors,
		PreflightID: fmt.Sprintf("pf-plan-%s-r%d", updated.ID, updated.Revision),
	}
	return s.interventionEngine.CompletePlanValidation(intervention.ID, result)
}

func (s *Server) monitorSubmissionTerminalState(planID, resourceType, resourceID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Hour)
	defer cancel()

	interval := 10 * time.Second
	terminal, err := s.flow360.PollResourceTerminalState(ctx, resourceType, resourceID, interval)
	if err != nil {
		log.Printf("Terminal state monitoring ended for plan %s: %v (state: %s)", planID, err, terminal.State)
		s.handleMonitorTimeout(planID)
		return
	}

	log.Printf("Plan %s reached terminal state: %s", planID, terminal.State)

	plan, _ := s.plans.Get(planID)

	switch {
	case isSuccessState(terminal.State):
		_, err := s.plans.MarkComplete(planID, terminal.Details)
		if err != nil {
			log.Printf("Could not mark plan %s complete: %v", planID, err)
		}
		if plan.ProjectID != "" {
			s.refreshProjectTree(plan.ProjectID)
		}
	case isFailureState(terminal.State):
		runErr := fmt.Errorf("remote simulation ended with state: %s", terminal.State)
		_, err := s.plans.MarkFailed(planID, runErr)
		if err != nil {
			log.Printf("Could not mark plan %s failed: %v", planID, err)
		}
		fullPlan := plan
		fullPlan.Status = plans.StatusFailed
		s.autoCreateInterventionForRunError(ctx, fullPlan, runErr)
	default:
		log.Printf("Plan %s reached non-terminal state: %s", planID, terminal.State)
	}
}

func (s *Server) startPlanMonitor(plan plans.Plan) {
	resourceType, resourceID, ok := planMonitorTarget(plan)
	if !ok {
		log.Printf("Plan %s was submitted without a monitorable remote resource ID", plan.ID)
		return
	}
	go s.monitorSubmissionTerminalState(plan.ID, resourceType, resourceID)
}

func planMonitorTarget(plan plans.Plan) (string, string, bool) {
	remoteIDs := plan.RemoteIDs
	if remoteIDs == nil {
		remoteIDs = plans.ExtractRemoteIDs(plan.Result)
	}
	if remoteIDs == nil {
		return "", "", false
	}
	if remoteIDs.CaseID != "" {
		return "Case", remoteIDs.CaseID, true
	}
	if remoteIDs.MeshID != "" {
		switch strings.ToLower(plan.Target) {
		case "surface-mesh":
			return "SurfaceMesh", remoteIDs.MeshID, true
		case "volume-mesh":
			return "VolumeMesh", remoteIDs.MeshID, true
		}
	}
	if remoteIDs.GeometryID != "" {
		return "Geometry", remoteIDs.GeometryID, true
	}
	if remoteIDs.DraftID != "" {
		return "Draft", remoteIDs.DraftID, true
	}
	return "", "", false
}

func (s *Server) refreshProjectTree(projectID string) {
	if s.projectSyncClient == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, err := s.projectSyncClient.ProjectTree(ctx, projectID)
		if err != nil {
			log.Printf("Could not refresh project tree for %s: %v", projectID, err)
		}
	}()
}

func (s *Server) handleMonitorTimeout(planID string) {
	if plan, err := s.plans.Get(planID); err == nil {
		if plan.Status == plans.StatusSubmitted || plan.Status == plans.StatusRunning {
			log.Printf("Plan %s monitoring timed out, marking as reconciling", planID)
			_, _ = s.plans.MarkReconcilePending(planID, fmt.Errorf("monitoring timed out"))
		}
	}
}

func isSuccessState(state string) bool {
	switch strings.ToLower(state) {
	case "completed", "success", "succeeded", "done", "processed":
		return true
	default:
		return false
	}
}

func isFailureState(state string) bool {
	switch strings.ToLower(state) {
	case "failed", "error", "diverged", "cancelled", "canceled", "expired", "timed_out":
		return true
	default:
		return false
	}
}

func (s *Server) flow360ResourceDetail(c *gin.Context) {
	resourceType := c.Param("resource_type")
	if resourceType == "" {
		resourceType = "Geometry"
	}
	resourceID := c.Param("resource_id")
	cacheKey := resourceType + "/" + resourceID
	if strings.EqualFold(c.Query("cache"), "only") {
		if s.serveResourceDetailSnapshot(c, resourceType, resourceID, cacheKey) {
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "local resource snapshot is unavailable"})
		return
	}
	detail, err := s.flow360.ResourceDetail(
		c.Request.Context(),
		resourceType,
		resourceID,
	)
	if err != nil {
		if s.serveResourceDetailSnapshot(c, resourceType, resourceID, cacheKey) {
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
		if s.serveResourceDetailSnapshot(c, resourceType, resourceID, cacheKey) {
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

func (s *Server) serveResourceDetailSnapshot(c *gin.Context, resourceType, resourceID, cacheKey string) bool {
	if s.cache != nil {
		if entry, err := s.cache.Get("resource-detail", cacheKey); err == nil {
			s.writeResourceDetailSnapshot(c, entry.Data, entry.CachedAt, "cached Flow360 API snapshot")
			return true
		}
	}
	if s.mirror != nil {
		if payload, cachedAt, err := s.mirror.ResourceDetail(resourceType, resourceID); err == nil {
			s.writeResourceDetailSnapshot(c, payload, cachedAt, "synchronized Project mirror")
			return true
		}
	}
	return false
}

func (s *Server) writeResourceDetailSnapshot(c *gin.Context, payload json.RawMessage, cachedAt time.Time, source string) {
	c.Header("X-VibeSim-Data-Source", "cache")
	c.Header("X-VibeSim-Cached-At", cachedAt.Format(time.RFC3339Nano))
	c.Header("Warning", fmt.Sprintf(`110 - "Response is from the %s"`, source))
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
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
	if s.mirror != nil {
		manifest, manifestErr := s.mirror.ResourceVisualizationManifest(resourceType, resourceID)
		if manifestErr == nil {
			assetURL := fmt.Sprintf(
				"/api/flow360/resources/%s/%s/visualization/manifest.json",
				resourceType,
				resourceID,
			)
			preview, previewErr := flow360.GeometryUVFPreview(resourceID, manifest, assetURL)
			if previewErr == nil {
				c.Header("Cache-Control", "private, max-age=60")
				c.JSON(http.StatusOK, preview)
				return
			}
		}
		if s.projectSyncClient != nil {
			projectID, projectErr := s.mirror.ResourceProjectID(resourceType, resourceID)
			if projectErr == nil {
				visualization, visualizationErr := s.projectSyncClient.ResourceVisualization(
					c.Request.Context(),
					resourceType,
					resourceID,
				)
				if visualizationErr == nil {
					if _, persistErr := s.mirror.PutResourceVisualization(
						projectID,
						resourceType,
						resourceID,
						visualization.Manifest,
						visualization.Bins,
						0,
					); persistErr == nil {
						assetURL := fmt.Sprintf(
							"/api/flow360/resources/%s/%s/visualization/manifest.json",
							resourceType,
							resourceID,
						)
						if preview, previewErr := flow360.GeometryUVFPreview(resourceID, visualization.Manifest, assetURL); previewErr == nil {
							c.Header("Cache-Control", "private, max-age=60")
							c.JSON(http.StatusOK, preview)
							return
						}
					}
				}
			}
		}
	}

	if s.flow360 == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "3D preview data is not available for this resource"})
		return
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

func (s *Server) flow360GeometryDiagnostics(c *gin.Context) {
	resourceID := c.Param("resource_id")
	if err := flow360.ValidateResourcePath("Geometry", resourceID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.mirror == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "server-backed Geometry diagnostics require a synchronized visualization manifest"})
		return
	}
	manifest, err := s.mirror.GeometryVisualizationManifest(resourceID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "synchronize this Geometry before running diagnostics"})
		return
	}
	ratio := 0.1
	if raw := strings.TrimSpace(c.Query("small_surface_ratio")); raw != "" {
		parsed, parseErr := strconv.ParseFloat(raw, 64)
		if parseErr != nil || parsed <= 0 || parsed > 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "small_surface_ratio must be greater than 0 and at most 1"})
			return
		}
		ratio = parsed
	}
	curvatureAngle := 30.0
	if raw := strings.TrimSpace(c.Query("curvature_angle_deg")); raw != "" {
		parsed, parseErr := strconv.ParseFloat(raw, 64)
		if parseErr != nil || parsed <= 0 || parsed > 180 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "curvature_angle_deg must be greater than 0 and at most 180"})
			return
		}
		curvatureAngle = parsed
	}
	settings := geometrydiag.Settings{SmallSurfaceRatio: ratio, CurvatureAngleDeg: curvatureAngle}
	cacheKey := resourceID + ":" + geometrydiag.Fingerprint(manifest, nil, settings)
	if report, ok := s.cachedGeometryDiagnostics(cacheKey); ok {
		s.writeGeometryDiagnostics(c, report, "HIT")
		return
	}
	buffers := map[string][]byte{}
	if paths, pathErr := flow360.TessellationDefaultBinPaths(manifest); pathErr == nil {
		for _, path := range paths {
			payload, readErr := s.mirror.GeometryVisualizationFile(resourceID, path)
			if readErr == nil {
				buffers[path] = payload
			}
		}
	}
	report, err := geometrydiag.AnalyzeWithBuffers(resourceID, manifest, buffers, settings)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	s.storeGeometryDiagnostics(cacheKey, report)
	s.writeGeometryDiagnostics(c, report, "MISS")
}

func (s *Server) writeGeometryDiagnostics(c *gin.Context, report geometrydiag.Report, cacheStatus string) {
	c.Header("ETag", fmt.Sprintf("\"geometry-diagnostics-%s\"", report.Fingerprint))
	c.Header("Cache-Control", "private, max-age=60")
	c.Header("X-Geometry-Diagnostics-Cache", cacheStatus)
	c.JSON(http.StatusOK, report)
}

func (s *Server) cachedGeometryDiagnostics(key string) (geometrydiag.Report, bool) {
	s.geometryDiagMu.Lock()
	defer s.geometryDiagMu.Unlock()
	entry, ok := s.geometryDiagCache[key]
	if !ok || time.Since(entry.CreatedAt) > 30*time.Minute {
		if ok {
			delete(s.geometryDiagCache, key)
		}
		return geometrydiag.Report{}, false
	}
	return entry.Report, true
}

func (s *Server) storeGeometryDiagnostics(key string, report geometrydiag.Report) {
	s.geometryDiagMu.Lock()
	defer s.geometryDiagMu.Unlock()
	if s.geometryDiagCache == nil {
		s.geometryDiagCache = map[string]geometryDiagnosticsCacheEntry{}
	}
	if len(s.geometryDiagCache) >= 64 {
		oldestKey := ""
		oldest := time.Now()
		for candidate, entry := range s.geometryDiagCache {
			if entry.CreatedAt.Before(oldest) {
				oldestKey = candidate
				oldest = entry.CreatedAt
			}
		}
		delete(s.geometryDiagCache, oldestKey)
	}
	s.geometryDiagCache[key] = geometryDiagnosticsCacheEntry{Report: report, CreatedAt: time.Now()}
}

func (s *Server) flow360GeometryComparison(c *gin.Context) {
	resourceID := c.Param("resource_id")
	compareID := c.Param("compare_id")
	if err := flow360.ValidateResourcePath("Geometry", resourceID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := flow360.ValidateResourcePath("Geometry", compareID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if resourceID == compareID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "select a different Geometry version to compare"})
		return
	}
	if s.mirror == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Geometry comparison requires synchronized visualization manifests"})
		return
	}
	baseline, err := s.mirror.GeometryVisualizationManifest(resourceID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "baseline Geometry visualization is not synchronized"})
		return
	}
	candidate, err := s.mirror.GeometryVisualizationManifest(compareID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "comparison Geometry visualization is not synchronized"})
		return
	}
	comparison, err := geometrydiag.Compare(resourceID, baseline, compareID, candidate)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.Header("Cache-Control", "private, max-age=60")
	c.JSON(http.StatusOK, comparison)
}

func (s *Server) flow360ResourceVisualizationAsset(c *gin.Context) {
	resourceType := c.Param("resource_type")
	resourceID := c.Param("resource_id")
	if err := flow360.ValidateResourcePath(resourceType, resourceID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.mirror == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "visualization asset is unavailable"})
		return
	}
	relative := strings.TrimPrefix(c.Param("asset_path"), "/")
	payload, err := s.mirror.ResourceVisualizationFile(resourceType, resourceID, relative)
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

func validFlow360ProjectID(value string) bool {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "prj-") || len(value) > 96 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '-' {
			continue
		}
		return false
	}
	return true
}

func normalizeFlow360ProjectName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("project name is required")
	}
	if utf8.RuneCountInString(value) > 128 {
		return "", errors.New("project name must be 128 characters or fewer")
	}
	for _, char := range value {
		if char < 0x20 || char == 0x7f {
			return "", errors.New("project name cannot contain control characters")
		}
	}
	return value, nil
}

func (s *Server) renameFlow360Project(c *gin.Context) {
	projectID := strings.TrimSpace(c.Param("project_id"))
	if !validFlow360ProjectID(projectID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}
	var request struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project request"})
		return
	}
	name, err := normalizeFlow360ProjectName(request.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	raw, err := s.flow360.RenameProject(c.Request.Context(), projectID, name)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 could not rename the project"})
		return
	}
	s.writeLiveJSON(c, raw)
}

func (s *Server) deleteFlow360Project(c *gin.Context) {
	projectID := strings.TrimSpace(c.Param("project_id"))
	if !validFlow360ProjectID(projectID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}
	if !strings.EqualFold(c.Query("confirmed"), "true") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project deletion requires confirmed=true"})
		return
	}
	raw, err := s.flow360.DeleteProject(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 could not delete the project"})
		return
	}
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

func (s *Server) flow360ProjectDrafts(c *gin.Context) {
	s.flow360ProjectJSON(c, "draft-list", s.flow360.ProjectDrafts)
}

func (s *Server) flow360DraftParameterSchema(c *gin.Context) {
	draftID := strings.TrimSpace(c.Param("draft_id"))
	if draftID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "draft_id is required"})
		return
	}
	detail, err := s.flow360.ResourceDetail(c.Request.Context(), "Draft", draftID)
	if err != nil || len(detail.SimulationParams) == 0 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Draft SimulationParams are unavailable"})
		return
	}
	sourceType := draftSourceType(detail.Info)
	form, err := s.flow360.PlanFormSchema(c.Request.Context(), sourceType, "case", detail.SimulationParams)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	schema, err := combinedPlanFormSchema(form)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not combine the Draft parameter schemas"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"schema_version":    form.SchemaVersion,
		"validator_version": form.ValidatorVersion,
		"source_type":       sourceType,
		"stages":            form.Stages,
		"schema":            json.RawMessage(schema),
		"baseline":          detail.SimulationParams,
	})
}

const maxDraftParametersRequestBytes = 2 << 20

type updateDraftParametersRequest struct {
	SimulationParams json.RawMessage `json:"simulation_params"`
}

func (s *Server) updateFlow360DraftParameters(c *gin.Context) {
	draftID := strings.TrimSpace(c.Param("draft_id"))
	if draftID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "draft_id is required"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxDraftParametersRequestBytes)
	var request updateDraftParametersRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Draft SimulationParams are too large"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Draft SimulationParams request"})
		return
	}
	var object map[string]any
	if !json.Valid(request.SimulationParams) || json.Unmarshal(request.SimulationParams, &object) != nil || object == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Draft SimulationParams must be a JSON object"})
		return
	}
	canonical, err := s.flow360.SetDraftSimulationParams(c.Request.Context(), draftID, request.SimulationParams)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"simulation_params": canonical})
}

func draftSourceType(info json.RawMessage) string {
	var metadata map[string]any
	if json.Unmarshal(info, &metadata) == nil {
		for _, key := range []string{"source_type", "root_resource_type", "parent_type"} {
			if value, ok := metadata[key].(string); ok {
				switch strings.ToLower(strings.NewReplacer("-", "", "_", "").Replace(strings.TrimSpace(value))) {
				case "geometry":
					return "Geometry"
				case "surfacemesh":
					return "SurfaceMesh"
				case "volumemesh":
					return "VolumeMesh"
				case "case":
					return "Case"
				}
			}
		}
	}
	// Older Flow360 Draft metadata does not expose source_type. Geometry is the
	// only root that safely projects every editable SimulationParams stage.
	return "Geometry"
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
	case "draft-list":
		for _, key := range []string{"records", "drafts", "items"} {
			if _, ok := payload[key].([]any); ok {
				return true
			}
		}
		return false
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

const flow360RootFolderID = "ROOT.FLOW360"

func validFlow360FolderID(value string, allowRoot bool) bool {
	value = strings.TrimSpace(value)
	if allowRoot && value == flow360RootFolderID {
		return true
	}
	if !strings.HasPrefix(value, "folder-") || len(value) > 96 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '-' {
			continue
		}
		return false
	}
	return true
}

func normalizeFlow360FolderName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("folder name is required")
	}
	if utf8.RuneCountInString(value) > 128 {
		return "", errors.New("folder name must be 128 characters or fewer")
	}
	for _, char := range value {
		if char < 0x20 || char == 0x7f {
			return "", errors.New("folder name cannot contain control characters")
		}
	}
	return value, nil
}

func (s *Server) refreshFolderTreeCache(ctx context.Context) {
	raw, err := s.flow360.Folders(ctx)
	if err != nil {
		log.Printf("Could not refresh Folder tree after mutation: %v", err)
		return
	}
	s.cacheLiveJSON("folder-tree", "root", raw)
}

func (s *Server) createFlow360Folder(c *gin.Context) {
	var request struct {
		Name           string   `json:"name"`
		ParentFolderID string   `json:"parent_folder_id"`
		Tags           []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder request"})
		return
	}
	name, err := normalizeFlow360FolderName(request.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	parentID := strings.TrimSpace(request.ParentFolderID)
	if parentID == "" {
		parentID = flow360RootFolderID
	}
	if !validFlow360FolderID(parentID, true) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid parent folder ID"})
		return
	}
	raw, err := s.flow360.CreateFolder(c.Request.Context(), name, parentID, request.Tags)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 could not create the folder"})
		return
	}
	s.refreshFolderTreeCache(c.Request.Context())
	s.writeLiveJSON(c, raw)
}

func (s *Server) renameFlow360Folder(c *gin.Context) {
	folderID := strings.TrimSpace(c.Param("folder_id"))
	if !validFlow360FolderID(folderID, false) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder ID"})
		return
	}
	var request struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder request"})
		return
	}
	name, err := normalizeFlow360FolderName(request.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	raw, err := s.flow360.RenameFolder(c.Request.Context(), folderID, name)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 could not rename the folder"})
		return
	}
	s.refreshFolderTreeCache(c.Request.Context())
	s.writeLiveJSON(c, raw)
}

func (s *Server) moveFlow360Folder(c *gin.Context) {
	folderID := strings.TrimSpace(c.Param("folder_id"))
	if !validFlow360FolderID(folderID, false) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder ID"})
		return
	}
	var request struct {
		ParentFolderID string `json:"parent_folder_id"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder request"})
		return
	}
	parentID := strings.TrimSpace(request.ParentFolderID)
	if !validFlow360FolderID(parentID, true) || parentID == folderID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid destination parent folder"})
		return
	}
	raw, err := s.flow360.MoveFolder(c.Request.Context(), folderID, parentID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 could not move the folder"})
		return
	}
	s.refreshFolderTreeCache(c.Request.Context())
	s.writeLiveJSON(c, raw)
}

func (s *Server) deleteFlow360Folder(c *gin.Context) {
	folderID := strings.TrimSpace(c.Param("folder_id"))
	if !validFlow360FolderID(folderID, false) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder ID"})
		return
	}
	if !strings.EqualFold(c.Query("confirmed"), "true") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder deletion requires confirmed=true"})
		return
	}
	raw, err := s.flow360.DeleteFolder(c.Request.Context(), folderID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Flow360 could not delete the folder; it may not be empty"})
		return
	}
	s.refreshFolderTreeCache(c.Request.Context())
	s.writeLiveJSON(c, raw)
}

func (s *Server) chatStream(c *gin.Context) {
	var request agent.ChatRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if s.chatSessions != nil && strings.TrimSpace(request.ProjectID) != "" {
		session, err := s.chatSessions.Get(request.ProjectID, request.ResourceID)
		if err == nil {
			request.History = session.Messages
		} else if !errors.Is(err, agent.ErrChatSessionNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		_, promptContext := agent.BuildChatPrompt(request)
		if (promptContext.ProjectID != "" && promptContext.ProjectID != request.ProjectID) ||
			(promptContext.SourceID != "" && promptContext.SourceID != request.ResourceID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chat scope does not match the structured context"})
			return
		}
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
	if s.chatSessions != nil && strings.TrimSpace(request.ProjectID) != "" {
		if _, err := s.chatSessions.Append(
			request.ProjectID,
			request.ResourceID,
			agent.Message{Role: "user", Content: request.Message},
			agent.Message{Role: "assistant", Content: reply},
		); err != nil {
			log.Printf("Could not persist Ask AI session for project %s: %v", request.ProjectID, err)
		}
	}

	scanner := bufio.NewScanner(strings.NewReader(reply))
	scanner.Split(scanWordsWithWhitespace)
	for scanner.Scan() {
		writeEvent(c.Writer, flusher, gin.H{"type": "delta", "delta": scanner.Text()})
	}
	writeEvent(c.Writer, flusher, gin.H{"type": "done"})
}

func (s *Server) getChatSession(c *gin.Context) {
	if s.chatSessions == nil {
		c.JSON(http.StatusOK, gin.H{"messages": []agent.Message{}})
		return
	}
	projectID := strings.TrimSpace(c.Query("project_id"))
	resourceID := strings.TrimSpace(c.Query("resource_id"))
	session, err := s.chatSessions.Get(projectID, resourceID)
	if errors.Is(err, agent.ErrChatSessionNotFound) {
		c.JSON(http.StatusOK, gin.H{
			"project_id":  projectID,
			"resource_id": resourceID,
			"messages":    []agent.Message{},
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, session)
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
		evidence := make([]plans.Evidence, 0, len(p.Fields))
		for _, field := range p.Fields {
			evidence = append(evidence, plans.Evidence{
				Key:         field.Key,
				Value:       field.Value,
				Provenance:  string(field.Provenance),
				Description: field.Description,
			})
		}
		planInput := plans.CreateInput{
			ProjectID:       p.ProjectID,
			ProjectName:     p.ProjectName,
			SourceID:        p.SourceID,
			SourceType:      p.SourceType,
			SourceName:      p.SourceName,
			Target:          p.Target,
			Name:            p.Name,
			Intent:          p.Intent,
			Patch:           p.Patch,
			Evidence:        evidence,
			ValidationHints: append([]string(nil), p.ValidationHints...),
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
