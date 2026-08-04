package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

const maxAICreateIntentBytes = 4000
const maxAICreateRequestBytes = 20 << 10
const maxAICreateClarificationRounds = 8

var flow360ProjectIDPattern = regexp.MustCompile(`\bprj-[A-Za-z0-9][A-Za-z0-9-]{7,}\b`)

type aiCreateRequest struct {
	Intent    string         `json:"intent"`
	FolderID  string         `json:"folder_id"`
	SessionID string         `json:"session_id,omitempty"`
	Answers   map[string]any `json:"answers,omitempty"`
}

type aiCreateSession struct {
	ID        string                        `json:"id"`
	Intent    string                        `json:"intent"`
	FolderID  string                        `json:"folder_id"`
	Rounds    []aicreate.ClarificationRound `json:"rounds"`
	Pending   []aicreate.ClarificationField `json:"pending,omitempty"`
	CreatedAt time.Time                     `json:"created_at"`
	UpdatedAt time.Time                     `json:"updated_at"`
}

type aiCreateClarificationResponse struct {
	Status    string                        `json:"status"`
	SessionID string                        `json:"session_id"`
	Message   string                        `json:"message"`
	Round     int                           `json:"round"`
	Fields    []aicreate.ClarificationField `json:"fields"`
}

type aiCreateResponse struct {
	ProjectID        string             `json:"project_id"`
	RootResourceID   string             `json:"root_resource_id"`
	RootResourceType string             `json:"root_resource_type"`
	Blueprint        aicreate.Blueprint `json:"blueprint"`
	Plan             plans.Plan         `json:"plan"`
	Stages           []string           `json:"stages"`
}

func (s *Server) aiCreateProject(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAICreateRequestBytes)
	var request aiCreateRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "simulation requirement is too large"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid AI Create request"})
		return
	}
	request.Intent = strings.TrimSpace(request.Intent)
	request.FolderID = strings.TrimSpace(request.FolderID)
	request.SessionID = strings.TrimSpace(request.SessionID)
	if len(request.Intent) > maxAICreateIntentBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "simulation requirement is too large"})
		return
	}
	session, err := s.advanceAICreateSession(request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	blueprint, err := aicreate.DesignConversation(c.Request.Context(), s.agent, session.Intent, session.Rounds)
	if err != nil {
		var missing *aicreate.MissingInputError
		if errors.As(err, &missing) {
			s.setAICreateSessionPending(session.ID, missing.Fields)
			c.JSON(http.StatusOK, aiCreateClarificationResponse{
				Status: "needs_input", SessionID: session.ID,
				Message: "I need a few engineering decisions before I can create reliable CAD and complete Flow360 parameters.",
				Round:   len(session.Rounds) + 1, Fields: missing.Fields,
			})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": humanizeAICreateDesignError(err)})
		return
	}

	stagingRoot := filepath.Join(s.workDir, "ai-create")
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare generated geometry"})
		return
	}
	stagingDir, err := os.MkdirTemp(stagingRoot, "agent-cad-")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare generated geometry"})
		return
	}
	defer os.RemoveAll(stagingDir)
	geometryName := safeGeometryName(blueprint.Geometry.Name) + ".step"
	geometryPath := filepath.Join(stagingDir, geometryName)
	generator := s.cadGenerator
	if generator == nil {
		generator = aicreate.NewCadQueryGenerator()
	}
	blueprint, validation, err := s.generateAICreateCAD(c.Request.Context(), generator, session, blueprint, geometryPath)
	if err != nil {
		var missing *aicreate.MissingInputError
		if errors.As(err, &missing) {
			s.setAICreateSessionPending(session.ID, missing.Fields)
			c.JSON(http.StatusOK, aiCreateClarificationResponse{
				Status: "needs_input", SessionID: session.ID,
				Message: "The Agent found a CAD construction issue and needs an engineering decision to continue self-repair.",
				Round:   len(session.Rounds) + 1, Fields: missing.Fields,
			})
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": humanizeAICreateGenerationError(err)})
		return
	}
	blueprint.Geometry.Validated = true
	blueprint.Geometry.Validation = fmt.Sprintf("Round-trip exact STEP validation passed: %d solids, %d faces, volume %.8g m^3, %d named bodies and %d named faces (%s).", validation.SolidCount, validation.FaceCount, validation.Volume, len(validation.BodyNames), len(validation.FaceNames), validation.Kernel)
	if err := validateAICreateAsset(geometryPath, "geometry"); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	rawResult, err := s.flow360.CreateProjectSync(
		c.Request.Context(), []string{geometryPath}, "geometry", blueprint.ProjectName,
		blueprint.Geometry.Unit, "standard", "", session.FolderID, []string{"ai-create", "agent-cad-v1"},
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": humanizeAICreateProjectError(err)})
		return
	}
	normalized, err := s.normalizeAICreateResult(c.Request.Context(), rawResult, "geometry")
	if err != nil {
		projectID := findProjectIDFromRaw(rawResult)
		payload := gin.H{"error": err.Error()}
		if projectID != "" {
			payload["project_id"] = projectID
		}
		c.JSON(http.StatusBadGateway, payload)
		return
	}
	var remote struct {
		ProjectID      string `json:"project_id"`
		RootResourceID string `json:"root_resource_id"`
	}
	if err := json.Unmarshal(normalized, &remote); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not read the AI-created project result"})
		return
	}
	baseline, err := s.waitForAICreateSimulationParams(c.Request.Context(), remote.RootResourceID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":      "Project was created, but Flow360 did not finish preparing its simulation parameters",
			"project_id": remote.ProjectID,
		})
		return
	}
	completePatch, err := aicreate.CompleteSimulationPatch(baseline, blueprint.SimulationParams)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": err.Error(), "project_id": remote.ProjectID,
		})
		return
	}
	blueprint.SimulationParams = completePatch
	patch, err := json.Marshal(blueprint.SimulationParams)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not serialize generated parameters"})
		return
	}
	evidence := []plans.Evidence{
		{Key: "geometry.generator", Value: blueprint.Geometry.Generator, Provenance: "derived", Description: "Constrained CAD program selected by the geometry agent."},
		{Key: "geometry.operations", Value: len(blueprint.Geometry.Operations), Provenance: "derived", Description: "Validated parametric and boolean CAD operations."},
		{Key: "geometry.validation", Value: blueprint.Geometry.Validation, Provenance: "derived", Description: "Exact CAD kernel and STEP round-trip validation."},
		{Key: "models.Wall.entities", Value: "Geometry face groups", Provenance: "derived", Description: "Resolved from the imported CAD entity cache."},
		{Key: "simulation.parameters", Value: "agent-derived and schema-preflighted", Provenance: "inferred", Description: "Operating, meshing, and solver values interpreted from the request and explicit assumptions."},
	}
	plan, err := s.plans.Create(plans.CreateInput{
		ProjectID: remote.ProjectID, ProjectName: blueprint.ProjectName,
		SourceID: remote.RootResourceID, SourceType: "Geometry", SourceName: geometryName,
		Target: blueprint.Target, Name: "AI Create · " + blueprint.ProjectName, Intent: session.Intent,
		Patch: patch, Baseline: baseline, Evidence: evidence, ValidationHints: blueprint.Assumptions,
		IdempotencyKey: "ai-create:" + remote.ProjectID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "project was created, but its simulation plan could not be saved", "project_id": remote.ProjectID})
		return
	}
	plan = s.runPlanPreflight(c.Request.Context(), plan)
	stages := aiCreateCompletionStages(plan)
	s.completeAICreateSession(session.ID)

	c.JSON(http.StatusCreated, aiCreateResponse{
		ProjectID: remote.ProjectID, RootResourceID: remote.RootResourceID,
		RootResourceType: "Geometry", Blueprint: blueprint, Plan: plan,
		Stages: stages,
	})
}

func aiCreateCompletionStages(plan plans.Plan) []string {
	stages := []string{"Agent interpreted requirement", "Agent authored a constrained CAD program", "Generated and validated exact STEP", "Created Flow360 Project", "Resolved CAD boundaries", "Loaded complete simulation parameters"}
	if plan.Preflight != nil && plan.Preflight.Valid {
		return append(stages, "Passed Flow360 schema preflight")
	}
	return append(stages, "Opened Agent Recovery for remaining Flow360 parameter issues")
}

func (s *Server) generateAICreateCAD(ctx context.Context, generator aicreate.Generator, session aiCreateSession, blueprint aicreate.Blueprint, outputPath string) (aicreate.Blueprint, aicreate.GeometryValidation, error) {
	validation, err := generator.Generate(ctx, blueprint.Geometry, outputPath)
	if err == nil {
		return blueprint, validation, nil
	}
	if aicreate.GenerationFailure(err) == aicreate.GenerationTemporaryFailure {
		validation, err = generator.Generate(ctx, blueprint.Geometry, outputPath)
		if err == nil {
			return blueprint, validation, nil
		}
	}
	if aicreate.GenerationFailure(err) != aicreate.GenerationGeometryFailure {
		return blueprint, validation, err
	}
	repaired, repairErr := aicreate.RepairAfterGenerationFailure(ctx, s.agent, session.Intent, session.Rounds, blueprint, err.Error())
	if repairErr != nil {
		return blueprint, validation, repairErr
	}
	validation, err = generator.Generate(ctx, repaired.Geometry, outputPath)
	if err != nil {
		return repaired, validation, fmt.Errorf("CAD self-repair was exhausted: %w", err)
	}
	return repaired, validation, nil
}

func (s *Server) advanceAICreateSession(request aiCreateRequest) (aiCreateSession, error) {
	s.aiCreateMu.Lock()
	defer s.aiCreateMu.Unlock()
	if s.aiCreateSessions == nil {
		s.aiCreateSessions = map[string]aiCreateSession{}
	}
	if request.SessionID == "" {
		if request.Intent == "" {
			return aiCreateSession{}, errors.New("simulation requirement is required")
		}
		if request.FolderID == "" {
			return aiCreateSession{}, errors.New("select a destination folder before creating a project")
		}
		identifier, err := newSubmissionID()
		if err != nil {
			return aiCreateSession{}, errors.New("could not start an AI Create session")
		}
		now := time.Now().UTC()
		session := aiCreateSession{
			ID: strings.Replace(identifier, "sub-", "aic-", 1), Intent: request.Intent, FolderID: request.FolderID,
			CreatedAt: now, UpdatedAt: now,
		}
		s.aiCreateSessions[session.ID] = session
		return session, nil
	}
	session, ok := s.aiCreateSessions[request.SessionID]
	if !ok {
		return aiCreateSession{}, errors.New("AI Create session expired; start again with the original request")
	}
	if len(session.Rounds) >= maxAICreateClarificationRounds {
		return aiCreateSession{}, errors.New("AI Create reached the clarification limit; revise the original request or attach exact CAD")
	}
	if len(session.Pending) == 0 {
		return aiCreateSession{}, errors.New("AI Create session is not waiting for clarification")
	}
	answers, err := validateAICreateAnswers(session.Pending, request.Answers)
	if err != nil {
		return aiCreateSession{}, err
	}
	session.Rounds = append(session.Rounds, aicreate.ClarificationRound{Fields: session.Pending, Answers: answers})
	session.Pending = nil
	session.UpdatedAt = time.Now().UTC()
	s.aiCreateSessions[session.ID] = session
	return session, nil
}

func (s *Server) setAICreateSessionPending(sessionID string, fields []aicreate.ClarificationField) {
	s.aiCreateMu.Lock()
	defer s.aiCreateMu.Unlock()
	session, ok := s.aiCreateSessions[sessionID]
	if !ok {
		return
	}
	session.Pending = append([]aicreate.ClarificationField(nil), fields...)
	session.UpdatedAt = time.Now().UTC()
	s.aiCreateSessions[sessionID] = session
}

func (s *Server) completeAICreateSession(sessionID string) {
	s.aiCreateMu.Lock()
	defer s.aiCreateMu.Unlock()
	delete(s.aiCreateSessions, sessionID)
}

func validateAICreateAnswers(fields []aicreate.ClarificationField, supplied map[string]any) (map[string]any, error) {
	answers := make(map[string]any, len(fields))
	for _, field := range fields {
		value, present := supplied[field.ID]
		if !present || value == nil || value == "" {
			if field.Required {
				return nil, fmt.Errorf("%s is required", field.Label)
			}
			continue
		}
		switch field.Type {
		case "number":
			number, ok := value.(float64)
			if !ok || number != number {
				return nil, fmt.Errorf("%s must be a number", field.Label)
			}
			if field.Min != nil && number < *field.Min || field.Max != nil && number > *field.Max {
				return nil, fmt.Errorf("%s is outside the allowed range", field.Label)
			}
		case "boolean":
			if _, ok := value.(bool); !ok {
				return nil, fmt.Errorf("%s must be yes or no", field.Label)
			}
		case "select":
			selected, ok := value.(string)
			valid := false
			for _, option := range field.Options {
				valid = valid || selected == option.Value
			}
			if !ok || !valid {
				return nil, fmt.Errorf("%s has an invalid selection", field.Label)
			}
		case "text":
			text, ok := value.(string)
			if !ok || len(strings.TrimSpace(text)) > 2000 {
				return nil, fmt.Errorf("%s must be valid text", field.Label)
			}
		default:
			return nil, fmt.Errorf("%s has an unsupported input type", field.Label)
		}
		answers[field.ID] = value
	}
	return answers, nil
}

var unsafeGeometryName = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

func safeGeometryName(name string) string {
	name = strings.Trim(unsafeGeometryName.ReplaceAllString(strings.TrimSpace(name), "-"), "-")
	if name == "" {
		return "agent-geometry"
	}
	if len(name) > 80 {
		name = strings.Trim(name[:80], "-")
	}
	return name
}

const (
	aiCreateParamsLookupAttempts = 20
	aiCreateParamsLookupDelay    = 500 * time.Millisecond
)

func (s *Server) waitForAICreateSimulationParams(ctx context.Context, geometryID string) (json.RawMessage, error) {
	var lastErr error
	for attempt := 0; attempt < aiCreateParamsLookupAttempts; attempt++ {
		detail, err := s.flow360.ResourceDetail(ctx, "Geometry", geometryID)
		if err == nil && aiCreateSimulationParamsReady(detail.SimulationParams) {
			return detail.SimulationParams, nil
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = errors.New("Geometry SimulationParams are not available yet")
		}
		if attempt == aiCreateParamsLookupAttempts-1 {
			break
		}
		timer := time.NewTimer(aiCreateParamsLookupDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
}

func aiCreateSimulationParamsReady(raw json.RawMessage) bool {
	if len(raw) == 0 || !json.Valid(raw) {
		return false
	}
	var document map[string]any
	if json.Unmarshal(raw, &document) != nil {
		return false
	}
	if wrapped, ok := document["simulation_params"].(map[string]any); ok {
		document = wrapped
	}
	_, hasVersion := document["version"].(string)
	models, hasModels := document["models"].([]any)
	cache, hasCache := document["private_attribute_asset_cache"].(map[string]any)
	_, hasEntityInfo := cache["project_entity_info"].(map[string]any)
	return hasVersion && hasModels && len(models) > 0 && hasCache && hasEntityInfo
}

func validateAICreateAsset(path, sourceType string) error {
	extension := strings.ToLower(filepath.Ext(path))
	if strings.EqualFold(sourceType, "geometry") {
		switch extension {
		case ".step", ".stp", ".igs", ".iges", ".cax", ".catpart", ".catproduct":
		default:
			return fmt.Errorf("%s is a tessellated or unsupported asset; Flow360 Geometry requires a client-supported exact CAD format such as STEP or IGES", filepath.Base(path))
		}
		if extension == ".step" || extension == ".stp" {
			file, err := os.Open(path)
			if err != nil {
				return fmt.Errorf("read generated STEP: %w", err)
			}
			defer file.Close()
			preview, err := io.ReadAll(io.LimitReader(file, 256<<10))
			if err != nil {
				return fmt.Errorf("read generated STEP: %w", err)
			}
			upper := bytes.ToUpper(preview)
			hasTopology := bytes.Contains(upper, []byte("ADVANCED_FACE")) || bytes.Contains(upper, []byte("MANIFOLD_SOLID_BREP"))
			if !bytes.Contains(upper, []byte("ISO-10303-21")) || !hasTopology || bytes.Contains(upper, []byte("FACET_NORMAL")) {
				return fmt.Errorf("%s is not a validated exact STEP B-rep", filepath.Base(path))
			}
		}
	}
	return nil
}

func humanizeAICreateProjectError(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "name resolution"), strings.Contains(message, "failed to resolve"), strings.Contains(message, "connection error"):
		return "Could not reach Flow360. Check the network connection and try again."
	case strings.Contains(message, "not a supported geometry"), strings.Contains(message, "not a supported geometry or surface mesh file"):
		return "The generated CAD format is not supported by the installed Flow360 client."
	case strings.Contains(message, "authentication"), strings.Contains(message, "unauthorized"), strings.Contains(message, "api key"):
		return "Flow360 authentication failed. Check the active profile and try again."
	default:
		return "Flow360 could not create the AI-generated Project. Check the service connection and try again."
	}
}

func humanizeAICreateDesignError(err error) string {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "unavailable") {
		return "The AI Create Agent is unavailable. Check the Agent configuration and try again."
	}
	return "The Agent could not produce a valid CAD plan after an automatic repair attempt. Refine the geometry description and try again."
}

func humanizeAICreateGenerationError(err error) string {
	switch aicreate.GenerationFailure(err) {
	case aicreate.GenerationRuntimeFailure:
		return "The exact CAD runtime is unavailable. Check the local CAD runtime configuration and try again."
	case aicreate.GenerationTemporaryFailure:
		return "The local CAD runtime encountered a temporary problem and could not recover after retrying. Try again shortly."
	default:
		return "The Agent could not produce valid exact CAD after self-repair. Add the defining geometry dimensions or attach exact CAD and try again."
	}
}

const (
	aiCreateRootLookupAttempts = 8
	aiCreateRootLookupDelay    = 350 * time.Millisecond
)

func (s *Server) normalizeAICreateResult(ctx context.Context, raw json.RawMessage, sourceType string) (json.RawMessage, error) {
	return normalizeAICreateResultWithLookup(
		ctx, raw, sourceType, s.flow360.ProjectItems,
		aiCreateRootLookupAttempts, aiCreateRootLookupDelay,
	)
}

func normalizeAICreateResultWithLookup(
	ctx context.Context,
	raw json.RawMessage,
	sourceType string,
	lookup func(context.Context, string) (json.RawMessage, error),
	attempts int,
	delay time.Duration,
) (json.RawMessage, error) {
	normalized, err := normalizeImportResult(raw, sourceType)
	if err == nil {
		return normalized, nil
	}
	projectID := findProjectIDFromRaw(raw)
	if projectID == "" {
		return nil, err
	}
	expectedType := strings.ReplaceAll(strings.ToLower(sourceType), "-", "")
	var lastErr error
	if attempts < 1 {
		attempts = 1
	}
	for attempt := 0; attempt < attempts; attempt++ {
		items, itemsErr := lookup(ctx, projectID)
		if itemsErr == nil {
			if rootID := findTypedResourceIDFromRaw(items, expectedType); rootID != "" {
				var flowResult any
				if json.Unmarshal(raw, &flowResult) != nil {
					flowResult = map[string]any{"raw": string(raw)}
				}
				return json.Marshal(map[string]any{
					"project_id": projectID, "root_resource_id": rootID,
					"root_resource_type": sourceType, "flow360_result": flowResult,
				})
			}
			lastErr = errors.New("root resource is not visible in the Project yet")
		} else {
			lastErr = itemsErr
		}
		if attempt == attempts-1 {
			break
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, fmt.Errorf("Project %s was created, but its root resource is not available yet: %w", projectID, lastErr)
}

func findStringFieldFromRaw(raw json.RawMessage, keys map[string]bool) string {
	var data any
	if json.Unmarshal(raw, &data) != nil {
		return ""
	}
	return findStringField(data, keys)
}

func findProjectIDFromRaw(raw json.RawMessage) string {
	var data any
	if json.Unmarshal(raw, &data) != nil {
		return ""
	}
	if projectID := findStringField(data, map[string]bool{"project_id": true, "projectid": true}); projectID != "" {
		return projectID
	}
	if projectID := findTypedResourceID(data, "project"); projectID != "" {
		return projectID
	}
	return findProjectIDInText(data)
}

func findProjectIDInText(value any) string {
	switch typed := value.(type) {
	case string:
		return flow360ProjectIDPattern.FindString(typed)
	case map[string]any:
		for _, child := range typed {
			if projectID := findProjectIDInText(child); projectID != "" {
				return projectID
			}
		}
	case []any:
		for _, child := range typed {
			if projectID := findProjectIDInText(child); projectID != "" {
				return projectID
			}
		}
	}
	return ""
}

func findTypedResourceIDFromRaw(raw json.RawMessage, expectedType string) string {
	var data any
	if json.Unmarshal(raw, &data) != nil {
		return ""
	}
	return findTypedResourceID(data, expectedType)
}
