package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

const maxAICreateIntentCharacters = 4000
const maxAICreateRequestBytes = 20 << 10
const maxAICreateClarificationRounds = 8
const maxAICreateCADRepairAttempts = 3
const aiCreateProjectReconcileAttempts = 15
const aiCreateProjectReconcileDelay = 2 * time.Second
const aiCreateOperationTimeout = 45 * time.Minute

var flow360ProjectIDPattern = regexp.MustCompile(`\bprj-[A-Za-z0-9][A-Za-z0-9-]{7,}\b`)

type aiCreateRequest struct {
	Intent     string         `json:"intent"`
	FolderID   string         `json:"folder_id"`
	SessionID  string         `json:"session_id,omitempty"`
	ProgressID string         `json:"request_id,omitempty"`
	Answers    map[string]any `json:"answers,omitempty"`
}

type aiCreateSession struct {
	ID          string                        `json:"id"`
	Intent      string                        `json:"intent"`
	FolderID    string                        `json:"folder_id"`
	Rounds      []aicreate.ClarificationRound `json:"rounds"`
	Pending     []aicreate.ClarificationField `json:"pending,omitempty"`
	Phase       string                        `json:"phase"`
	CAD         *aiCreateCADCheckpoint        `json:"cad,omitempty"`
	Prepared    *aiCreatePrepared             `json:"prepared,omitempty"`
	Parameters  *aiCreateParameterCheckpoint  `json:"parameters,omitempty"`
	DraftID     string                        `json:"draft_id,omitempty"`
	CreatedAt   time.Time                     `json:"created_at"`
	UpdatedAt   time.Time                     `json:"updated_at"`
	CompletedAt *time.Time                    `json:"completed_at,omitempty"`
}

type aiCreateCADCheckpoint struct {
	GeometryName string                      `json:"geometry_name"`
	GeometryPath string                      `json:"geometry_path"`
	Blueprint    aicreate.Blueprint          `json:"blueprint"`
	Validation   aicreate.GeometryValidation `json:"validation"`
}

type aiCreateParameterCheckpoint struct {
	Blueprint        aicreate.Blueprint      `json:"blueprint"`
	SimulationParams json.RawMessage         `json:"simulation_params"`
	Preflight        flow360.PreflightResult `json:"preflight"`
}

type aiCreatePrepared struct {
	ProjectID      string             `json:"project_id"`
	RootResourceID string             `json:"root_resource_id"`
	GeometryName   string             `json:"geometry_name"`
	Blueprint      aicreate.Blueprint `json:"blueprint"`
	Baseline       json.RawMessage    `json:"baseline"`
	BoundaryPatch  json.RawMessage    `json:"boundary_patch"`
}

type aiCreateImportedGeometry struct {
	ProjectID      string
	RootResourceID string
	Baseline       json.RawMessage
}

type aiCreateClarificationResponse struct {
	Status    string                        `json:"status"`
	SessionID string                        `json:"session_id"`
	Message   string                        `json:"message"`
	Round     int                           `json:"round"`
	Fields    []aicreate.ClarificationField `json:"fields"`
}

type aiCreateResponse struct {
	ProjectID        string                   `json:"project_id"`
	DraftID          string                   `json:"draft_id,omitempty"`
	RootResourceID   string                   `json:"root_resource_id"`
	RootResourceType string                   `json:"root_resource_type"`
	Blueprint        aicreate.Blueprint       `json:"blueprint"`
	SimulationParams json.RawMessage          `json:"simulation_params"`
	Preflight        *flow360.PreflightResult `json:"preflight,omitempty"`
	Stages           []string                 `json:"stages"`
	Warnings         []string                 `json:"warnings,omitempty"`
}

func (s *Server) aiCreateProject(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAICreateRequestBytes)
	var request aiCreateRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"code": "request_too_large", "field": "intent",
				"error":             fmt.Sprintf("The AI Create request exceeds the %d-byte request limit. Shorten the simulation description or clarification answers and try again.", maxAICreateRequestBytes),
				"max_request_bytes": maxAICreateRequestBytes,
				"request_bytes":     c.Request.ContentLength,
			})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid AI Create request"})
		return
	}
	intentCharacters := utf8.RuneCountInString(request.Intent)
	intentBytes := len(request.Intent)
	request.Intent = strings.TrimSpace(request.Intent)
	request.FolderID = strings.TrimSpace(request.FolderID)
	request.SessionID = strings.TrimSpace(request.SessionID)
	request.ProgressID = strings.TrimSpace(request.ProgressID)
	if intentCharacters > maxAICreateIntentCharacters {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"code": "input_too_long", "field": "intent",
			"error": fmt.Sprintf(
				"Simulation description is %d characters; the maximum is %d. Remove at least %d characters and try again.",
				intentCharacters, maxAICreateIntentCharacters, intentCharacters-maxAICreateIntentCharacters,
			),
			"actual_characters": intentCharacters,
			"max_characters":    maxAICreateIntentCharacters,
			"actual_bytes":      intentBytes,
		})
		return
	}
	if request.ProgressID != "" {
		if !s.startAICreateProgress(request.ProgressID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid AI Create request ID"})
			return
		}
		c.Set("ai_create_progress_id", request.ProgressID)
		defer func() {
			if c.Writer.Status() >= http.StatusBadRequest {
				s.failAICreateProgressIfRunning(request.ProgressID, "AI Create stopped at this stage. See the reported error for details.")
			}
		}()
	}
	// Project creation is an idempotent, resumable backend operation. A browser
	// navigation or a brief local service transition must not cancel it midway
	// after Flow360 has already accepted the Geometry.
	operationContext, cancelOperation := context.WithTimeout(context.WithoutCancel(c.Request.Context()), aiCreateOperationTimeout)
	defer cancelOperation()
	c.Request = c.Request.WithContext(operationContext)
	session, err := s.advanceAICreateSession(request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	s.bindAICreateProgressSession(request.ProgressID, session.ID)
	if session.Prepared != nil {
		s.updateAICreateProgress(request.ProgressID, 3, "The existing Flow360 Project and Geometry are ready; loading the active parameter schemas.")
		s.finishAICreateParameters(c, session, *session.Prepared)
		return
	}

	blueprint, validation, geometryPath, geometryName, err := s.prepareAICreateCAD(c.Request.Context(), session, request.ProgressID)
	if err != nil {
		var missing *aicreate.MissingInputError
		if errors.As(err, &missing) {
			s.finishAICreateProgress(request.ProgressID, "needs_input", "The Geometry Agent needs an engineering decision before CAD generation can continue.", "", "")
			s.setAICreateSessionPending(session.ID, missing.Fields)
			response := aiCreateClarificationResponse{
				Status: "needs_input", SessionID: session.ID,
				Message: "I need a few engineering decisions before I can create reliable CAD and complete Flow360 parameters.",
				Round:   len(session.Rounds) + 1, Fields: missing.Fields,
			}
			s.storeAICreateProgressResponse(request.ProgressID, response)
			c.JSON(http.StatusOK, response)
			return
		}
		var designErr *aiCreateDesignStageError
		if errors.As(err, &designErr) {
			log.Printf("AI Create design stage failed for session %s: %v", session.ID, designErr)
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": humanizeAICreateDesignError(designErr)})
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": humanizeAICreateGenerationError(err)})
		return
	}
	generator := s.cadGenerator
	if generator == nil {
		generator = aicreate.NewCadQueryGenerator()
	}

	remote, err := s.importAICreateGeometry(c.Request.Context(), session.FolderID, blueprint, geometryPath, request.ProgressID)
	if err != nil {
		payload := gin.H{"error": err.Error()}
		if remote.ProjectID != "" {
			payload["project_id"] = remote.ProjectID
		}
		c.JSON(http.StatusBadGateway, payload)
		return
	}
	for repairAttempt := 1; ; repairAttempt++ {
		contractErr := aicreate.ValidateImportedGeometryContract(remote.Baseline, blueprint.Geometry)
		if contractErr == nil {
			break
		}
		if repairAttempt > maxAICreateCADRepairAttempts {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":      fmt.Sprintf("The Geometry Agent could not reconcile the STEP boundary contract with Flow360 after %d self-repairs: %s", maxAICreateCADRepairAttempts, lastAICreateDiagnosticLine(contractErr.Error())),
				"project_id": remote.ProjectID,
			})
			return
		}
		s.updateAICreateProgress(request.ProgressID, 2, fmt.Sprintf("Flow360 entity reconciliation found a mechanical STEP boundary defect; the Geometry Agent is applying import self-repair %d of %d.", repairAttempt, maxAICreateCADRepairAttempts))
		repaired, repairErr := aicreate.RepairAfterGenerationFailure(c.Request.Context(), s.agent, session.Intent, session.Rounds, blueprint, contractErr.Error())
		if repairErr != nil {
			// Imported topology and naming are implementation details, not an
			// engineering decision. Do not turn them into a user form.
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":      "The Geometry Agent could not autonomously repair the Flow360 STEP boundary contract: " + repairErr.Error(),
				"project_id": remote.ProjectID,
			})
			return
		}
		repaired, validation, repairErr = s.generateAICreateCAD(c.Request.Context(), generator, session, repaired, geometryPath, request.ProgressID)
		if repairErr != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":      humanizeAICreateGenerationError(repairErr),
				"project_id": remote.ProjectID,
			})
			return
		}
		repaired.Geometry.Validated = true
		repaired.Geometry.Validation = fmt.Sprintf("Round-trip exact STEP and complete boundary coverage validation passed: %d solids, %d faces, volume %.8g m^3, %d named bodies and %d named faces (%s).", validation.SolidCount, validation.FaceCount, validation.Volume, len(validation.BodyNames), len(validation.FaceNames), validation.Kernel)
		// The Project is a candidate created by this request and has not been
		// exposed as a successful result. Remove it transactionally before
		// importing the repaired STEP so users do not accumulate broken Projects.
		if _, deleteErr := s.flow360.DeleteProject(c.Request.Context(), remote.ProjectID); deleteErr != nil {
			c.JSON(http.StatusBadGateway, gin.H{
				"error":      "The Agent repaired the STEP locally, but could not roll back the incomplete candidate Project before retrying the import.",
				"project_id": remote.ProjectID,
			})
			return
		}
		blueprint = repaired
		s.setAICreateSessionCAD(session.ID, aiCreateCADCheckpoint{GeometryName: geometryName, GeometryPath: geometryPath, Blueprint: repaired, Validation: validation})
		remote, err = s.importAICreateGeometry(c.Request.Context(), session.FolderID, blueprint, geometryPath, request.ProgressID)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error(), "project_id": remote.ProjectID})
			return
		}
	}
	blueprint.Geometry.Validation += " Flow360 import entity reconciliation passed."
	baseline := remote.Baseline
	// Geometry planning emits engineering hints, not authoritative Flow360
	// paths. Start the parameter phase from canonical Flow360 data plus the
	// deterministic CAD entity assignments so guessed keys cannot leak into the
	// Draft before the schema-native Agent runs.
	completePatch, err := aicreate.CompleteSimulationPatch(baseline, map[string]any{})
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": err.Error(), "project_id": remote.ProjectID,
		})
		return
	}
	boundaryPatch, err := json.Marshal(completePatch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not serialize generated parameters"})
		return
	}
	prepared := aiCreatePrepared{
		ProjectID: remote.ProjectID, RootResourceID: remote.RootResourceID,
		GeometryName: geometryName, Blueprint: blueprint,
		Baseline: append(json.RawMessage(nil), baseline...), BoundaryPatch: boundaryPatch,
	}
	s.setAICreateSessionPrepared(session.ID, prepared)
	s.finishAICreateParameters(c, session, prepared)
}

func (s *Server) finishAICreateParameters(c *gin.Context, session aiCreateSession, prepared aiCreatePrepared) {
	progressID := aiCreateProgressID(c)
	s.bindAICreateProgressResources(progressID, prepared.ProjectID, prepared.RootResourceID)
	if session.Parameters != nil {
		s.updateAICreateProgress(progressID, 5, "Reusing the session's schema-valid parameter checkpoint; only Flow360 Draft configuration remains.")
		s.finishAICreateDraft(c, session, prepared, *session.Parameters)
		return
	}
	s.updateAICreateProgress(progressID, 3, "Querying the installed Flow360 Geometry-to-Case schemas against the Project's canonical SimulationParams.")
	boundaryBaseline, err := plans.MergedSimulationParams(plans.Plan{Baseline: prepared.Baseline, Patch: prepared.BoundaryPatch})
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "could not prepare the schema-aware Flow360 baseline", "project_id": prepared.ProjectID})
		return
	}
	form, err := s.flow360.PlanFormSchema(c.Request.Context(), "Geometry", "case", boundaryBaseline)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not load the active Flow360 parameter schemas", "project_id": prepared.ProjectID})
		return
	}
	confirmedInputs := aiCreateConfirmedInputPayload(session.Rounds)
	composer := planComposerContext{
		Request: planComposerRequest{
			ProjectID: prepared.ProjectID, ProjectName: prepared.Blueprint.ProjectName,
			SourceID: prepared.RootResourceID, SourceType: "Geometry", SourceName: prepared.GeometryName,
			Target: "case", Intent: session.Intent,
			Prompt:          "Configure a complete, reviewable Flow360 setup that can run without manual parameter editing. Act autonomously on configuration-level choices: for a basic, introductory, benchmark, or ready-to-run request, choose canonical defensible CFD defaults for operating conditions, mesh controls, turbulence model, steady versus unsteady solver, time step, and outputs, and record them as assumptions. Preserve the generated spanwise symmetry boundaries. Never introduce a Periodic model in Geometry-to-Case AI Create because no reviewed conformal VolumeMesh exists to prove identical paired node counts. Request user input only for a physical ambiguity that would materially change the engineering objective; never ask the user to repair CAD topology, entity names, selectors, or schema wiring.",
			ConfirmedInputs: confirmedInputs, Autonomous: true,
		},
		Name: prepared.GeometryName, Baseline: boundaryBaseline, Form: form,
	}
	s.updateAICreateProgress(progressID, 4, "The parameter Agent is filling only schema-allowed fields, then Flow360 preflight will validate the complete setup.")
	assisted, err := s.generateSchemaNativePlan(c.Request.Context(), composer)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "the parameter Agent could not produce a schema-valid Flow360 setup: " + err.Error(), "project_id": prepared.ProjectID})
		return
	}
	if assisted.Action.Kind == agent.ActionRequestMissingInput {
		fields := aiCreateParameterClarificationFields(assisted.Action.Questions)
		if len(fields) == 0 {
			c.JSON(http.StatusBadGateway, gin.H{"error": "the parameter Agent requested input without providing usable fields", "project_id": prepared.ProjectID})
			return
		}
		s.finishAICreateProgress(progressID, "needs_input", "The parameter Agent needs an engineering decision before it can complete the schema-valid setup.", prepared.ProjectID, prepared.RootResourceID)
		s.setAICreateSessionPending(session.ID, fields)
		response := aiCreateClarificationResponse{
			Status: "needs_input", SessionID: session.ID,
			Message: assisted.Action.Message,
			Round:   len(session.Rounds) + 1, Fields: fields,
		}
		s.storeAICreateProgressResponse(progressID, response)
		c.JSON(http.StatusOK, response)
		return
	}
	if assisted.Proposal == nil || assisted.Preflight == nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "the parameter Agent returned an incomplete Flow360 parameter setup", "project_id": prepared.ProjectID})
		return
	}
	patch, err := mergePlanAssistPatches(prepared.BoundaryPatch, assisted.Proposal.Patch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not combine geometry and simulation parameters", "project_id": prepared.ProjectID})
		return
	}
	blueprint := prepared.Blueprint
	var finalPatch map[string]any
	if json.Unmarshal(patch, &finalPatch) == nil {
		blueprint.SimulationParams = finalPatch
	}
	mergedParams, err := plans.MergedSimulationParams(plans.Plan{Baseline: prepared.Baseline, Patch: patch})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "project was created, but its validated parameters could not be checkpointed", "project_id": prepared.ProjectID})
		return
	}
	checkpoint := aiCreateParameterCheckpoint{
		Blueprint: blueprint, SimulationParams: mergedParams, Preflight: *assisted.Preflight,
	}
	s.setAICreateSessionParameters(session.ID, checkpoint)
	s.finishAICreateDraft(c, session, prepared, checkpoint)
}

func (s *Server) finishAICreateDraft(c *gin.Context, session aiCreateSession, prepared aiCreatePrepared, checkpoint aiCreateParameterCheckpoint) {
	progressID := aiCreateProgressID(c)
	draftID := ""
	warnings := []string(nil)
	if checkpoint.Preflight.Valid {
		s.updateAICreateProgress(progressID, 5, "Flow360 preflight passed; resolving the Project's existing Draft and loading the validated parameters into it.")
		_, createdDraftID, draftErr := s.materializeAICreateDraftParameters(
			c.Request.Context(), prepared.ProjectID, prepared.RootResourceID,
			"AI Create · "+checkpoint.Blueprint.ProjectName, checkpoint.SimulationParams,
		)
		draftID = createdDraftID
		if draftErr != nil {
			log.Printf("AI Create remote Draft setup failed for session %s: %v", session.ID, draftErr)
			s.finishAICreateProgress(progressID, "needs_attention", "The Project and validated parameters are ready, but Flow360 Draft configuration needs recovery.", prepared.ProjectID, prepared.RootResourceID)
			c.JSON(http.StatusBadGateway, gin.H{
				"error":      "The Project and schema-valid parameters were preserved, but Flow360 Draft configuration did not finish. Retry this session to continue from the Draft step: " + draftErr.Error(),
				"project_id": prepared.ProjectID, "session_id": session.ID, "draft_id": draftID,
			})
			return
		}
	} else {
		s.finishAICreateProgress(progressID, "needs_attention", "The Project was created, but Flow360 parameter validation still needs review; its Draft was not modified.", prepared.ProjectID, prepared.RootResourceID)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Flow360 parameter validation did not pass", "project_id": prepared.ProjectID, "session_id": session.ID})
		return
	}
	if draftID != "" {
		s.finishAICreateProgress(progressID, "completed", "The exact CAD, Flow360 Project, schema-valid parameters, preflight, and configured Draft are all ready for review.", prepared.ProjectID, prepared.RootResourceID)
	}
	stages := aiCreateCompletionStages(checkpoint.Preflight.Valid, draftID != "")
	s.completeAICreateSession(session.ID, draftID)

	response := aiCreateResponse{
		ProjectID: prepared.ProjectID, DraftID: draftID, RootResourceID: prepared.RootResourceID,
		RootResourceType: "Geometry", Blueprint: checkpoint.Blueprint,
		SimulationParams: checkpoint.SimulationParams, Preflight: &checkpoint.Preflight,
		Stages: stages, Warnings: warnings,
	}
	s.storeAICreateProgressResponse(progressID, response)
	c.JSON(http.StatusCreated, response)
}

func aiCreateConfirmedInputPayload(rounds []aicreate.ClarificationRound) json.RawMessage {
	answers := map[string]any{}
	for _, round := range rounds {
		for key, value := range round.Answers {
			answers[key] = value
		}
	}
	payload, err := json.Marshal(answers)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return payload
}

func (s *Server) importAICreateGeometry(ctx context.Context, folderID string, blueprint aicreate.Blueprint, geometryPath, progressID string) (aiCreateImportedGeometry, error) {
	result := aiCreateImportedGeometry{}
	projectCreateStartedAt := time.Now().UTC()
	s.updateAICreateProgress(progressID, 2, "Flow360 is uploading the exact STEP and processing the Project root Geometry (--sync).")
	rawResult, err := s.flow360.CreateProjectSync(
		ctx, []string{geometryPath}, "geometry", blueprint.ProjectName,
		blueprint.Geometry.Unit, "standard", "", folderID, []string{"ai-create", "agent-cad-v1"},
	)
	if err != nil {
		return result, errors.New(humanizeAICreateProjectError(err))
	}
	if findProjectIDFromRaw(rawResult) == "" {
		reconciled, reconcileErr := reconcileAICreateProjectResult(
			ctx, rawResult, blueprint.ProjectName, "geometry",
			projectCreateStartedAt.Add(-30*time.Second),
			func(ctx context.Context, name, sourceType string, notBefore time.Time) (json.RawMessage, error) {
				return s.flow360.FindProjectByName(ctx, folderID, name, sourceType, notBefore)
			},
			aiCreateProjectReconcileAttempts, aiCreateProjectReconcileDelay,
		)
		if reconcileErr == nil {
			rawResult = reconciled
		} else {
			log.Printf("AI Create could not reconcile incomplete Flow360 Project response %s: %v", compactAICreateResult(rawResult), reconcileErr)
		}
	}
	result.ProjectID = findProjectIDFromRaw(rawResult)
	normalized, err := s.normalizeAICreateResult(ctx, rawResult, "geometry")
	if err != nil {
		return result, err
	}
	var remote struct {
		ProjectID      string `json:"project_id"`
		RootResourceID string `json:"root_resource_id"`
	}
	if err := json.Unmarshal(normalized, &remote); err != nil {
		return result, errors.New("could not read the AI-created project result")
	}
	result.ProjectID, result.RootResourceID = remote.ProjectID, remote.RootResourceID
	s.bindAICreateProgressResources(progressID, result.ProjectID, result.RootResourceID)
	s.updateAICreateProgress(progressID, 3, "Flow360 Project processing completed; querying Geometry state, canonical SimulationParams, and imported boundary entities.")
	result.Baseline, err = s.waitForAICreateSimulationParams(ctx, result.RootResourceID, progressID)
	if err != nil {
		return result, errors.New("Project was created, but Flow360 did not finish preparing its simulation parameters")
	}
	return result, nil
}

func reconcileAICreateProjectResult(
	ctx context.Context,
	original json.RawMessage,
	name, sourceType string,
	notBefore time.Time,
	lookup func(context.Context, string, string, time.Time) (json.RawMessage, error),
	attempts int,
	delay time.Duration,
) (json.RawMessage, error) {
	if findProjectIDFromRaw(original) != "" {
		return original, nil
	}
	if attempts < 1 {
		attempts = 1
	}
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		project, err := lookup(ctx, name, sourceType, notBefore)
		if err == nil {
			var record map[string]any
			if json.Unmarshal(project, &record) == nil {
				if projectID, _ := record["id"].(string); strings.TrimSpace(projectID) != "" {
					return json.Marshal(map[string]any{
						"project_id":         strings.TrimSpace(projectID),
						"reconciled_project": record,
						"flow360_result":     json.RawMessage(original),
					})
				}
			}
			lastErr = errors.New("reconciled Flow360 Project has no ID")
		} else {
			lastErr = err
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
	return nil, fmt.Errorf("newly created Flow360 Project was not visible during reconciliation: %w", lastErr)
}

func compactAICreateResult(raw json.RawMessage) string {
	value := strings.Join(strings.Fields(string(raw)), " ")
	if len(value) > 2000 {
		return value[:2000] + "…"
	}
	return value
}

func aiCreateCompletionStages(preflightValid, draftReady bool) []string {
	stages := []string{"Agent interpreted requirement", "Agent authored a constrained CAD program", "Generated and validated exact STEP", "Created Flow360 Project", "Resolved CAD boundaries", "Loaded complete simulation parameters"}
	if preflightValid {
		stages = append(stages, "Passed Flow360 schema preflight")
		if draftReady {
			return append(stages, "Resolved Project Flow360 Draft", "Stored canonical Draft SimulationParams", "Ready for review and approval")
		}
		return append(stages, "Flow360 Draft setup needs recovery")
	}
	return append(stages, "Opened Agent Recovery for remaining Flow360 parameter issues")
}

func (s *Server) materializeAICreateDraftParameters(ctx context.Context, projectID, sourceID, name string, simulationParams json.RawMessage) (json.RawMessage, string, error) {
	created, err := s.flow360.EnsureDraft(ctx, projectID, sourceID, name)
	if err != nil {
		return nil, "", err
	}
	remoteIDs := plans.ExtractRemoteIDs(created)
	if remoteIDs == nil || strings.TrimSpace(remoteIDs.DraftID) == "" {
		return nil, "", errors.New("Flow360 Draft creation did not return a Draft ID")
	}
	canonical, err := s.flow360.SetDraftSimulationParams(ctx, remoteIDs.DraftID, simulationParams)
	if err != nil {
		canonical, err = s.flow360.SetDraftSimulationParams(ctx, remoteIDs.DraftID, simulationParams)
	}
	if err != nil {
		return nil, remoteIDs.DraftID, err
	}
	var canonicalObject map[string]any
	if json.Unmarshal(canonical, &canonicalObject) != nil || len(canonicalObject) == 0 {
		return nil, remoteIDs.DraftID, errors.New("Flow360 did not return canonical Draft SimulationParams")
	}
	return canonical, remoteIDs.DraftID, nil
}

type aiCreateCADRepairExhaustedError struct {
	Attempts   int
	Diagnostic string
}

type aiCreateDesignStageError struct{ Err error }

func (e *aiCreateDesignStageError) Error() string { return e.Err.Error() }
func (e *aiCreateDesignStageError) Unwrap() error { return e.Err }

func (e *aiCreateCADRepairExhaustedError) Error() string {
	return fmt.Sprintf("CAD self-repair failed after %d attempts: %s", e.Attempts, e.Diagnostic)
}

func (s *Server) prepareAICreateCAD(ctx context.Context, session aiCreateSession, progressID string) (aicreate.Blueprint, aicreate.GeometryValidation, string, string, error) {
	if session.CAD != nil {
		checkpoint := *session.CAD
		if err := validateAICreateAsset(checkpoint.GeometryPath, "geometry"); err == nil {
			s.updateAICreateProgress(progressID, 1, "Reusing the session's validated exact STEP checkpoint; CAD generation does not need to run again.")
			return checkpoint.Blueprint, checkpoint.Validation, checkpoint.GeometryPath, checkpoint.GeometryName, nil
		}
	}

	blueprint, err := aicreate.DesignConversation(ctx, s.agent, session.Intent, session.Rounds)
	if err != nil {
		return aicreate.Blueprint{}, aicreate.GeometryValidation{}, "", "", &aiCreateDesignStageError{Err: err}
	}
	s.updateAICreateProgress(progressID, 1, "The CAD design is ready; CadQuery/OpenCascade is generating and round-trip validating exact STEP geometry.")
	sessionDirectory := filepath.Join(s.workDir, "ai-create-sessions", session.ID)
	if err := os.MkdirAll(sessionDirectory, 0o700); err != nil {
		return blueprint, aicreate.GeometryValidation{}, "", "", errors.New("could not prepare the durable CAD session directory")
	}
	geometryName := safeGeometryName(blueprint.Geometry.Name) + ".step"
	geometryPath := filepath.Join(sessionDirectory, geometryName)
	generator := s.cadGenerator
	if generator == nil {
		generator = aicreate.NewCadQueryGenerator()
	}
	blueprint, validation, err := s.generateAICreateCAD(ctx, generator, session, blueprint, geometryPath, progressID)
	if err != nil {
		return blueprint, validation, geometryPath, geometryName, err
	}
	blueprint.Geometry.Validated = true
	blueprint.Geometry.Validation = fmt.Sprintf("Round-trip exact STEP and complete boundary coverage validation passed: %d solids, %d faces, volume %.8g m^3, %d named bodies and %d named faces (%s).", validation.SolidCount, validation.FaceCount, validation.Volume, len(validation.BodyNames), len(validation.FaceNames), validation.Kernel)
	if err := validateAICreateAsset(geometryPath, "geometry"); err != nil {
		return blueprint, validation, geometryPath, geometryName, err
	}
	s.setAICreateSessionCAD(session.ID, aiCreateCADCheckpoint{
		GeometryName: geometryName, GeometryPath: geometryPath,
		Blueprint: blueprint, Validation: validation,
	})
	return blueprint, validation, geometryPath, geometryName, nil
}

func (s *Server) generateAICreateCAD(ctx context.Context, generator aicreate.Generator, session aiCreateSession, blueprint aicreate.Blueprint, outputPath, progressID string) (aicreate.Blueprint, aicreate.GeometryValidation, error) {
	generate := func(candidate aicreate.Blueprint) (aicreate.GeometryValidation, error) {
		if err := aicreate.ValidateFlow360GeometryContract(candidate.Geometry); err != nil {
			return aicreate.GeometryValidation{}, err
		}
		validation, err := generator.Generate(ctx, candidate.Geometry, outputPath)
		if err != nil && aicreate.GenerationFailure(err) == aicreate.GenerationTemporaryFailure {
			return generator.Generate(ctx, candidate.Geometry, outputPath)
		}
		return validation, err
	}

	current := blueprint
	validation, err := generate(current)
	if err == nil {
		return current, validation, nil
	}
	if aicreate.GenerationFailure(err) != aicreate.GenerationGeometryFailure {
		return current, validation, err
	}
	diagnostic := err.Error()
	for attempt := 1; attempt <= maxAICreateCADRepairAttempts; attempt++ {
		s.updateAICreateProgress(progressID, 1, fmt.Sprintf("Exact CAD validation failed; the Geometry Agent is applying self-repair %d of %d.", attempt, maxAICreateCADRepairAttempts))
		repaired, repairErr := aicreate.RepairAfterGenerationFailure(ctx, s.agent, session.Intent, session.Rounds, current, diagnostic)
		if repairErr != nil {
			var missing *aicreate.MissingInputError
			if errors.As(repairErr, &missing) {
				return current, validation, repairErr
			}
			diagnostic = repairErr.Error()
			continue
		}
		current = repaired
		s.updateAICreateProgress(progressID, 1, fmt.Sprintf("Validating exact CAD produced by self-repair %d of %d.", attempt, maxAICreateCADRepairAttempts))
		validation, err = generate(current)
		if err == nil {
			return current, validation, nil
		}
		if aicreate.GenerationFailure(err) != aicreate.GenerationGeometryFailure {
			return current, validation, err
		}
		diagnostic = err.Error()
	}
	return current, validation, &aiCreateCADRepairExhaustedError{
		Attempts: maxAICreateCADRepairAttempts, Diagnostic: lastAICreateDiagnosticLine(diagnostic),
	}
}

func lastAICreateDiagnosticLine(diagnostic string) string {
	lines := strings.Split(strings.TrimSpace(diagnostic), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		runes := []rune(line)
		if len(runes) > 360 {
			line = string(runes[:360]) + "…"
		}
		return line
	}
	return "OpenCascade did not return a usable diagnostic"
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
			Phase: "understanding", CreatedAt: now, UpdatedAt: now,
		}
		s.aiCreateSessions[session.ID] = session
		s.persistAICreateSessionsLocked()
		return session, nil
	}
	session, ok := s.aiCreateSessions[request.SessionID]
	if !ok {
		return aiCreateSession{}, errors.New("AI Create session expired; start again with the original request")
	}
	if len(session.Pending) == 0 {
		return session, nil
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
	s.persistAICreateSessionsLocked()
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
	session.Phase = "needs_input"
	session.UpdatedAt = time.Now().UTC()
	s.aiCreateSessions[sessionID] = session
	s.persistAICreateSessionsLocked()
}

func (s *Server) setAICreateSessionCAD(sessionID string, checkpoint aiCreateCADCheckpoint) {
	s.aiCreateMu.Lock()
	defer s.aiCreateMu.Unlock()
	session, ok := s.aiCreateSessions[sessionID]
	if !ok {
		return
	}
	copy := checkpoint
	session.CAD = &copy
	session.Phase = "cad_validated"
	session.UpdatedAt = time.Now().UTC()
	s.aiCreateSessions[sessionID] = session
	s.persistAICreateSessionsLocked()
}

func (s *Server) setAICreateSessionPrepared(sessionID string, prepared aiCreatePrepared) {
	s.aiCreateMu.Lock()
	defer s.aiCreateMu.Unlock()
	session, ok := s.aiCreateSessions[sessionID]
	if !ok {
		return
	}
	copy := prepared
	copy.Baseline = append(json.RawMessage(nil), prepared.Baseline...)
	copy.BoundaryPatch = append(json.RawMessage(nil), prepared.BoundaryPatch...)
	session.Prepared = &copy
	session.Phase = "geometry_imported"
	session.UpdatedAt = time.Now().UTC()
	s.aiCreateSessions[sessionID] = session
	s.persistAICreateSessionsLocked()
}

func (s *Server) setAICreateSessionParameters(sessionID string, checkpoint aiCreateParameterCheckpoint) {
	s.aiCreateMu.Lock()
	defer s.aiCreateMu.Unlock()
	session, ok := s.aiCreateSessions[sessionID]
	if !ok {
		return
	}
	copy := checkpoint
	copy.SimulationParams = append(json.RawMessage(nil), checkpoint.SimulationParams...)
	session.Parameters = &copy
	session.Phase = "parameters_validated"
	session.UpdatedAt = time.Now().UTC()
	s.aiCreateSessions[sessionID] = session
	s.persistAICreateSessionsLocked()
}

func aiCreateParameterClarificationFields(questions []agent.Question) []aicreate.ClarificationField {
	fields := make([]aicreate.ClarificationField, 0, min(len(questions), 6))
	used := map[string]bool{}
	for index, question := range questions {
		if len(fields) == 6 {
			break
		}
		identifier := strings.TrimSpace(question.Field)
		if identifier == "" {
			identifier = fmt.Sprintf("parameter-%d", index+1)
		}
		base := identifier
		for suffix := 2; used[identifier]; suffix++ {
			identifier = fmt.Sprintf("%s-%d", base, suffix)
		}
		used[identifier] = true
		fieldType := strings.ToLower(strings.TrimSpace(question.Type))
		switch fieldType {
		case "number", "select", "boolean", "text":
		default:
			fieldType = "text"
		}
		description := strings.TrimSpace(question.Reason)
		if recommendation := strings.TrimSpace(question.Recommendation); recommendation != "" {
			if description != "" {
				description += " "
			}
			description += "Recommendation: " + recommendation
		}
		options := make([]aicreate.ClarificationOption, 0, len(question.Options))
		for _, option := range question.Options {
			options = append(options, aicreate.ClarificationOption{Value: option.Value, Label: option.Label})
		}
		fields = append(fields, aicreate.ClarificationField{
			ID: identifier, Label: question.Message, Description: description,
			Type: fieldType, Required: question.Urgency == "required", Unit: question.Unit,
			Options: options, Default: question.Default, Min: question.Min, Max: question.Max,
		})
	}
	return fields
}

func (s *Server) completeAICreateSession(sessionID, draftID string) {
	s.aiCreateMu.Lock()
	defer s.aiCreateMu.Unlock()
	session, ok := s.aiCreateSessions[sessionID]
	if !ok {
		return
	}
	now := time.Now().UTC()
	session.Phase = "completed"
	session.DraftID = strings.TrimSpace(draftID)
	session.CompletedAt = &now
	session.UpdatedAt = now
	s.aiCreateSessions[sessionID] = session
	s.persistAICreateSessionsLocked()
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

func (s *Server) waitForAICreateSimulationParams(ctx context.Context, geometryID, progressID string) (json.RawMessage, error) {
	var lastErr error
	for attempt := 0; attempt < aiCreateParamsLookupAttempts; attempt++ {
		detail, err := s.flow360.ResourceDetail(ctx, "Geometry", geometryID)
		if err == nil {
			if remoteDetail := aiCreateGeometryStateDetail(detail.State); remoteDetail != "" {
				s.updateAICreateProgress(progressID, 3, remoteDetail)
			}
		}
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

func aiCreateGeometryStateDetail(raw json.RawMessage) string {
	if len(raw) == 0 || !json.Valid(raw) {
		return ""
	}
	var state map[string]any
	if json.Unmarshal(raw, &state) != nil {
		return ""
	}
	remoteState := strings.TrimSpace(executionState(state))
	progress := executionProgress(state)
	if remoteState == "" && progress == nil {
		return ""
	}
	if remoteState == "" {
		return fmt.Sprintf("Flow360 Geometry reports %.0f%% complete; waiting for canonical SimulationParams.", *progress)
	}
	if progress != nil {
		return fmt.Sprintf("Flow360 Geometry state: %s (%.0f%%); waiting for canonical SimulationParams.", remoteState, *progress)
	}
	return fmt.Sprintf("Flow360 Geometry state: %s; waiting for canonical SimulationParams.", remoteState)
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
	var providerErr *agent.ProviderError
	if errors.As(err, &providerErr) {
		switch providerErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return "The AI Create model provider rejected its credentials. Check VIBESIM_AI_API_KEY and the configured provider account."
		case http.StatusTooManyRequests:
			return "The AI Create model provider is rate-limited or out of quota. Check the provider quota, then retry shortly."
		default:
			if providerErr.Retryable {
				return "The AI Create model provider is temporarily unavailable after an automatic retry. Try again shortly."
			}
			return "The AI Create model provider rejected the request. Check the configured base URL and model name."
		}
	}
	if _, timedOut := agent.GenerationTimeout(err); timedOut || errors.Is(err, context.DeadlineExceeded) {
		return "The AI Create model provider timed out. Try again shortly."
	}
	if strings.Contains(message, "unavailable") || strings.Contains(message, "requires a configured model provider") {
		return "The AI Create Agent is unavailable. Check the Agent configuration and try again."
	}
	return "The Agent could not produce a valid CAD plan after an automatic repair attempt. Refine the geometry description and try again."
}

func humanizeAICreateGenerationError(err error) string {
	var exhausted *aiCreateCADRepairExhaustedError
	if errors.As(err, &exhausted) {
		return fmt.Sprintf("The Geometry Agent tried %d CAD self-repairs, but exact STEP validation still failed. Last CAD diagnostic: %s", exhausted.Attempts, exhausted.Diagnostic)
	}
	switch aicreate.GenerationFailure(err) {
	case aicreate.GenerationRuntimeFailure:
		message := strings.ToLower(err.Error())
		switch {
		case strings.Contains(message, "cad runtime") && strings.Contains(message, "not found"):
			return "The exact CAD runtime could not find uv. The service checked the application directory, user-local tools, standard package-manager locations, and its PATH. Install uv or set VIBESIM_UV_BINARY to its absolute executable path."
		case strings.Contains(message, "no module named") && strings.Contains(message, "cadquery"):
			return "The exact CAD runtime found uv but could not load CadQuery 2.6.1. Run `make cad-runtime` to prepare the pinned dependency cache, or check VIBESIM_UV_CACHE_DIR and offline mode."
		case strings.Contains(message, "no interpreter found"), strings.Contains(message, "does not satisfy python"), strings.Contains(message, "requirements are unsatisfiable"):
			return "The exact CAD runtime found uv but could not locate a compatible Python. Install Python 3.11 or set VIBESIM_CAD_PYTHON to a supported interpreter/version."
		default:
			return "The exact CAD runtime is unavailable: " + lastAICreateDiagnosticLine(err.Error())
		}
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
	return s.normalizeCreatedProjectResult(ctx, raw, sourceType)
}

func (s *Server) normalizeCreatedProjectResult(ctx context.Context, raw json.RawMessage, sourceType string) (json.RawMessage, error) {
	normalized, err := normalizeCreatedProjectResultWithLookup(
		ctx, raw, sourceType, s.flow360.ProjectItems,
		aiCreateRootLookupAttempts, aiCreateRootLookupDelay,
	)
	if err != nil {
		return raw, err
	}
	return normalized, nil
}

func normalizeAICreateResultWithLookup(
	ctx context.Context,
	raw json.RawMessage,
	sourceType string,
	lookup func(context.Context, string) (json.RawMessage, error),
	attempts int,
	delay time.Duration,
) (json.RawMessage, error) {
	return normalizeCreatedProjectResultWithLookup(ctx, raw, sourceType, lookup, attempts, delay)
}

func normalizeCreatedProjectResultWithLookup(
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
