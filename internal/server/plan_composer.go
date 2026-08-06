package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

const maxPlanComposerRequestBytes = 300 << 10
const maxPlanAssistRepairAttempts = 3

type planComposerRequest struct {
	ProjectID       string          `json:"project_id"`
	ProjectName     string          `json:"project_name,omitempty"`
	SourceID        string          `json:"source_id"`
	SourceType      string          `json:"source_type"`
	SourceName      string          `json:"source_name,omitempty"`
	Target          string          `json:"target"`
	Intent          string          `json:"intent,omitempty"`
	Prompt          string          `json:"prompt,omitempty"`
	Patch           json.RawMessage `json:"patch,omitempty"`
	ConfirmedInputs json.RawMessage `json:"confirmed_inputs,omitempty"`
	Autonomous      bool            `json:"autonomous,omitempty"`
}

type planFormSchemaResponse struct {
	flow360.PlanFormSchema
	Baseline json.RawMessage `json:"baseline"`
}

type planAssistResponse struct {
	Action         agent.Action             `json:"action"`
	Proposal       *agent.Proposal          `json:"proposal,omitempty"`
	Preflight      *flow360.PreflightResult `json:"preflight,omitempty"`
	RepairAttempts int                      `json:"repair_attempts,omitempty"`
	AutoRepaired   bool                     `json:"auto_repaired,omitempty"`
}

type planComposerContext struct {
	Request  planComposerRequest
	Name     string
	Baseline json.RawMessage
	Form     flow360.PlanFormSchema
}

func (s *Server) planFormSchema(c *gin.Context) {
	request, ok := bindPlanComposerRequest(c)
	if !ok {
		return
	}
	context, err := s.loadPlanComposerContext(c.Request.Context(), request)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, planFormSchemaResponse{PlanFormSchema: context.Form, Baseline: context.Baseline})
}

func (s *Server) assistPlanForm(c *gin.Context) {
	request, ok := bindPlanComposerRequest(c)
	if !ok {
		return
	}
	if strings.TrimSpace(request.Prompt) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "an AI form prompt is required"})
		return
	}
	if s.agent == nil || !s.agent.SupportsGeneration() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI form filling requires a configured AI or Codex provider"})
		return
	}
	composer, err := s.loadPlanComposerContext(c.Request.Context(), request)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	result, err := s.generateSchemaNativePlan(c.Request.Context(), composer)
	if err != nil {
		status, response := planAssistAgentError(err)
		c.JSON(status, response)
		return
	}
	c.JSON(http.StatusOK, result)
}

// generateSchemaNativePlan is the shared parameter intelligence used by the
// interactive plan form and AI Create. It grounds the Agent in the installed
// Flow360 stage schemas, validates the candidate against the real client, and
// gives the Agent bounded opportunities to repair schema-mechanical failures.
func (s *Server) generateSchemaNativePlan(ctx context.Context, composer planComposerContext) (planAssistResponse, error) {
	catalog, err := schemaPromptCatalog(composer.Form)
	if err != nil {
		return planAssistResponse{}, errors.New("could not prepare the active Flow360 schema for the Agent")
	}
	contextPayload, err := json.Marshal(agent.ChatContextPayload{
		ProjectID: composer.Request.ProjectID, ProjectName: composer.Request.ProjectName,
		SourceID: composer.Request.SourceID, SourceType: composer.Request.SourceType,
		SourceName: composer.Name, Target: composer.Request.Target,
		SimulationParams: composer.Baseline, FormSchema: catalog,
		ConfirmedInputs: composer.Request.ConfirmedInputs,
	})
	if err != nil {
		return planAssistResponse{}, errors.New("could not prepare the plan context")
	}
	message := planAssistPrompt(composer.Request)
	_, action, err := s.agent.ChatWithValidation(ctx, agent.ChatRequest{
		Message: message, Context: string(contextPayload), Session: "web:plan-composer",
	})
	if err != nil {
		return planAssistResponse{}, err
	}
	action, err = s.resolveAutonomousPlanAssistQuestions(ctx, composer, contextPayload, action)
	if err != nil {
		return planAssistResponse{}, err
	}
	if action.Kind == agent.ActionRequestMissingInput {
		return planAssistResponse{Action: *action}, nil
	}
	activeSchema, err := combinedPlanFormSchema(composer.Form)
	if err != nil {
		return planAssistResponse{}, errors.New("could not combine the active Flow360 stage schemas")
	}
	repairAttempts := 0
	proposal, err := preparePlanAssistProposal(*action, composer, activeSchema)
	for err != nil && repairAttempts < maxPlanAssistRepairAttempts {
		repairAttempts++
		repairMessage := planAssistFormRepairPrompt(composer.Request, *action, err, repairAttempts)
		_, repairedAction, repairErr := s.agent.ChatWithValidation(ctx, agent.ChatRequest{
			Message: repairMessage, Context: string(contextPayload), Session: "web:plan-composer:form-repair",
		})
		if repairErr != nil {
			return planAssistResponse{}, repairErr
		}
		repairedAction, repairErr = s.resolveAutonomousPlanAssistQuestions(ctx, composer, contextPayload, repairedAction)
		if repairErr != nil {
			return planAssistResponse{}, repairErr
		}
		if repairedAction.Kind == agent.ActionRequestMissingInput {
			if composer.Request.Autonomous {
				action = repairedAction
				err = errors.New("the Agent requested user input for a schema-mechanical form correction")
				continue
			}
			return planAssistResponse{Action: *repairedAction, RepairAttempts: repairAttempts}, nil
		}
		action = repairedAction
		proposal, err = preparePlanAssistProposal(*action, composer, activeSchema)
	}
	if err != nil {
		return planAssistResponse{}, fmt.Errorf("AI form values remained outside the active Flow360 schema after %d repairs: %w", repairAttempts, err)
	}
	preflight, merged, err := s.preflightPlanAssistProposal(ctx, composer, proposal)
	if err != nil {
		return planAssistResponse{}, errors.New("AI form values could not be checked with Flow360: " + err.Error())
	}

	agentRepairAttempts := 0
	autoRepaired := false
	for !preflight.Valid && agentRepairAttempts < maxPlanAssistRepairAttempts {
		if recommendedPatch, applied, recommendationErr := recommendedPlanAssistPatch(preflight.FormSchema, merged); recommendationErr == nil && applied {
			proposal.Patch, err = mergePlanAssistPatches(proposal.Patch, recommendedPatch)
			if err == nil {
				repairAttempts++
				preflight, merged, err = s.preflightPlanAssistProposal(ctx, composer, proposal)
				if err == nil && preflight.Valid {
					autoRepaired = true
					break
				}
			}
		}
		agentRepairAttempts++
		repairAttempts++
		repairForm, formErr := s.flow360.PlanFormSchema(ctx, proposal.SourceType, proposal.Target, merged)
		if formErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair could not load the schema for the candidate configuration.")
			break
		}
		repairForm = includePlanRecoverySchema(repairForm, preflight.FormSchema)
		repairCatalog, catalogErr := schemaPromptCatalog(repairForm)
		if catalogErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair could not read the candidate schema.")
			break
		}
		repairContext, contextErr := json.Marshal(agent.ChatContextPayload{
			ProjectID: composer.Request.ProjectID, ProjectName: composer.Request.ProjectName,
			SourceID: composer.Request.SourceID, SourceType: composer.Request.SourceType,
			SourceName: composer.Name, Target: composer.Request.Target,
			SimulationParams: merged, FormSchema: repairCatalog,
			PreflightIssues: planAssistIssueContext(preflight.Issues),
			ConfirmedInputs: composer.Request.ConfirmedInputs,
		})
		if contextErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair could not prepare the validation context.")
			break
		}
		repairMessage := planAssistRepairPrompt(composer.Request, proposal, preflight, agentRepairAttempts)
		_, repairedAction, repairErr := s.agent.ChatWithValidation(ctx, agent.ChatRequest{
			Message: repairMessage, Context: string(repairContext), Session: "web:plan-composer:repair",
		})
		if repairErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair stopped because the Agent did not return a valid correction.")
			break
		}
		repairedAction, repairErr = s.resolveAutonomousPlanAssistQuestions(ctx, composer, repairContext, repairedAction)
		if repairErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair stopped while applying recommended defaults.")
			break
		}
		if repairedAction.Kind == agent.ActionRequestMissingInput {
			if composer.Request.Autonomous {
				action.Warnings = append(action.Warnings, fmt.Sprintf("The parameter Agent tried to expose a schema-mechanical correction as user input on repair %d; the request was rejected and retried.", agentRepairAttempts))
				continue
			}
			action = repairedAction
			break
		}
		repairSchema, schemaErr := combinedPlanFormSchema(repairForm)
		if schemaErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair could not combine the candidate schemas.")
			break
		}
		repairedProposal, proposalErr := preparePlanAssistProposal(*repairedAction, composer, repairSchema)
		if proposalErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair returned values outside the active Flow360 schema.")
			break
		}
		action = repairedAction
		proposal = repairedProposal
		preflight, merged, err = s.preflightPlanAssistProposal(ctx, composer, proposal)
		if err != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair could not re-run Flow360 validation.")
			break
		}
		if preflight.Valid {
			autoRepaired = true
		}
	}
	if composer.Request.Autonomous && !preflight.Valid {
		issues, _ := json.Marshal(preflight.Issues)
		return planAssistResponse{}, fmt.Errorf("the parameter Agent could not produce a schema-valid Flow360 setup after %d autonomous repairs; remaining preflight issues: %s", maxPlanAssistRepairAttempts, issues)
	}

	preflight.EditorSchemas = nil
	if action.Kind == agent.ActionCreatePlan && len(action.Proposals) == 1 {
		action.Proposals[0] = proposal
	}
	return planAssistResponse{
		Action: *action, Proposal: &proposal, Preflight: &preflight,
		RepairAttempts: repairAttempts, AutoRepaired: autoRepaired,
	}, nil
}

func includePlanRecoverySchema(form flow360.PlanFormSchema, recovery json.RawMessage) flow360.PlanFormSchema {
	const recoveryStage = "PreflightRecovery"
	copy := form
	copy.Stages = append(append([]string(nil), form.Stages...), recoveryStage)
	copy.Schemas = make(map[string]json.RawMessage, len(form.Schemas)+1)
	for stage, schema := range form.Schemas {
		copy.Schemas[stage] = append(json.RawMessage(nil), schema...)
	}
	copy.Schemas[recoveryStage] = append(json.RawMessage(nil), recovery...)
	return copy
}

func planAssistIssueContext(issues []flow360.PreflightIssue) []string {
	result := make([]string, 0, len(issues))
	for _, issue := range issues {
		path := strings.TrimSpace(issue.Path)
		message := strings.TrimSpace(issue.Message)
		if path == "" {
			result = append(result, message)
			continue
		}
		result = append(result, path+": "+message)
	}
	return result
}

func (s *Server) resolveAutonomousPlanAssistQuestions(ctx context.Context, composer planComposerContext, contextPayload []byte, action *agent.Action) (*agent.Action, error) {
	if !composer.Request.Autonomous {
		return action, nil
	}
	// One continuation is enough to apply an authoritative answer or an
	// Agent-provided default. More automatic turns hide a non-converging model
	// behind a long request and can repeatedly ask the same question.
	const maxAutonomousDefaultRounds = 1
	for round := 1; action.Kind == agent.ActionRequestMissingInput && round <= maxAutonomousDefaultRounds; round++ {
		// confirmed_inputs was already present in the generation context. Asking
		// for one of those fields again is a convergence failure, not a reason to
		// spend another model turn or show the same form to the user.
		if asksForConfirmedInput(action.Questions, composer.Request.ConfirmedInputs) {
			return action, nil
		}
		defaults, ok := authoritativeQuestionValues(action.Questions, composer.Request.ConfirmedInputs)
		if !ok {
			return action, nil
		}
		confirmed, _ := json.Marshal(map[string]any{
			"prior_user_confirmations":              json.RawMessage(composer.Request.ConfirmedInputs),
			"autonomously_accepted_recommendations": defaults,
		})
		var payload agent.ChatContextPayload
		if json.Unmarshal(contextPayload, &payload) == nil {
			payload.ConfirmedInputs = confirmed
			contextPayload, _ = json.Marshal(payload)
		}
		questions, _ := json.Marshal(action.Questions)
		defaultsJSON, _ := json.Marshal(defaults)
		message := fmt.Sprintf(`Continue the same autonomous Flow360 plan now. Every requested field now has an authoritative value, supplied either by the user or by an Agent recommendation. Do not request another confirmation for these fields.

Treat these values as confirmed and authoritative: %s
Previous questions: %s

Return one complete create-plan proposal using only the active schema catalog. Do not ask for any of these values again.`, defaultsJSON, questions)
		_, next, err := s.agent.ChatWithValidation(ctx, agent.ChatRequest{
			Message: message, Context: string(contextPayload), Session: "web:plan-composer:autonomous-defaults",
		})
		if err != nil {
			return nil, err
		}
		action = next
	}
	return action, nil
}

func asksForConfirmedInput(questions []agent.Question, confirmed json.RawMessage) bool {
	if len(questions) == 0 || len(confirmed) == 0 {
		return false
	}
	confirmedValues := map[string]any{}
	if json.Unmarshal(confirmed, &confirmedValues) != nil {
		return false
	}
	for _, question := range questions {
		if _, exists := confirmedValues[strings.TrimSpace(question.Field)]; exists {
			return true
		}
	}
	return false
}

func recommendedQuestionDefaults(questions []agent.Question) (map[string]any, bool) {
	return authoritativeQuestionValues(questions, nil)
}

func authoritativeQuestionValues(questions []agent.Question, confirmed json.RawMessage) (map[string]any, bool) {
	if len(questions) == 0 {
		return nil, false
	}
	confirmedValues := map[string]any{}
	if len(confirmed) > 0 {
		_ = json.Unmarshal(confirmed, &confirmedValues)
	}
	defaults := make(map[string]any, len(questions))
	for _, question := range questions {
		field := strings.TrimSpace(question.Field)
		if field == "" {
			return nil, false
		}
		if value, exists := confirmedValues[field]; exists {
			defaults[field] = value
			continue
		}
		if question.Default == nil || !validRecommendedQuestionDefault(question) {
			return nil, false
		}
		defaults[field] = question.Default
	}
	return defaults, true
}

func validRecommendedQuestionDefault(question agent.Question) bool {
	switch strings.ToLower(strings.TrimSpace(question.Type)) {
	case "select":
		value, ok := question.Default.(string)
		if !ok {
			return false
		}
		for _, option := range question.Options {
			if option.Value == value {
				return true
			}
		}
		return false
	case "number":
		value, ok := question.Default.(float64)
		return ok && (question.Min == nil || value >= *question.Min) && (question.Max == nil || value <= *question.Max)
	case "boolean":
		_, ok := question.Default.(bool)
		return ok
	case "text":
		_, ok := question.Default.(string)
		return ok
	default:
		return false
	}
}

func planAssistAgentError(err error) (int, gin.H) {
	if timeout, timedOut := agent.GenerationTimeout(err); timedOut {
		return http.StatusGatewayTimeout, gin.H{
			"code":      "ai_timeout",
			"retryable": true,
			"error": fmt.Sprintf(
				"AI parameter generation did not finish within %s. No form values were changed; retry the same request.",
				timeout,
			),
		}
	}
	return http.StatusBadGateway, gin.H{"error": "AI could not produce schema-valid form values: " + err.Error()}
}

func preparePlanAssistProposal(action agent.Action, composer planComposerContext, schema json.RawMessage) (agent.Proposal, error) {
	if len(action.Proposals) != 1 {
		return agent.Proposal{}, errors.New("AI form filling must return exactly one proposal")
	}
	proposal := action.Proposals[0]
	if proposal.SourceType != composer.Request.SourceType || proposal.Target != composer.Request.Target {
		return agent.Proposal{}, errors.New("AI proposal does not match the active source-to-target route")
	}
	proposal.ProjectID = composer.Request.ProjectID
	proposal.ProjectName = composer.Request.ProjectName
	proposal.SourceID = composer.Request.SourceID
	proposal.SourceName = composer.Name
	if strings.TrimSpace(proposal.Intent) == "" {
		proposal.Intent = composer.Request.Intent
	}
	if strings.TrimSpace(proposal.Name) == "" {
		proposal.Name = composer.Name + " · " + composer.Request.Target
	}
	sanitized, removed, err := plans.SanitizeFormValues(schema, proposal.Patch)
	if err != nil {
		return agent.Proposal{}, errors.New("AI form values could not be projected onto the active Flow360 schema: " + err.Error())
	}
	proposal.Patch = sanitized
	if len(removed) > 0 {
		sort.Strings(removed)
		proposal.ValidationHints = append(proposal.ValidationHints, "Removed non-editable canonical Flow360 fields echoed by the Agent: "+strings.Join(removed, ", "))
	}
	if err := plans.ValidateFormValues(schema, proposal.Patch); err != nil {
		return agent.Proposal{}, errors.New("AI form values do not match the active Flow360 schema: " + err.Error())
	}
	return proposal, nil
}

func planAssistFormRepairPrompt(request planComposerRequest, action agent.Action, validationErr error, attempt int) string {
	previous, _ := json.Marshal(action)
	return fmt.Sprintf(`The previous Flow360 form proposal was rejected before preflight because its values do not match the active stage schema.
This is a schema-mechanical problem. Repair it autonomously; do not ask the user to choose a field name, discriminator, unit wire shape, or model wiring.

Return exactly one create-plan proposal for the same %s-to-%s route. Its patch must use only paths present in the supplied schema catalog. Do not copy internal fields from canonical SimulationParams into an editable patch. In particular, quantity form values contain only value and units unless the catalog explicitly requests another key. Preserve confirmed engineering values and valid fields.

Original intent: %s
Repair attempt: %d of %d
Validation error: %s
Rejected action: %s`, request.SourceType, request.Target, request.Intent, attempt, maxPlanAssistRepairAttempts, validationErr.Error(), previous)
}

func (s *Server) preflightPlanAssistProposal(ctx context.Context, composer planComposerContext, proposal agent.Proposal) (flow360.PreflightResult, json.RawMessage, error) {
	compiled, err := plans.Compile(plans.CreateInput{
		ProjectID: proposal.ProjectID, ProjectName: proposal.ProjectName,
		SourceID: proposal.SourceID, SourceType: proposal.SourceType, SourceName: proposal.SourceName,
		Target: proposal.Target, Name: proposal.Name, Intent: proposal.Intent,
		Patch: proposal.Patch, Baseline: composer.Baseline,
	})
	if err != nil {
		return flow360.PreflightResult{}, nil, errors.New("AI form values could not be compiled: " + err.Error())
	}
	merged, err := plans.MergedSimulationParams(compiled)
	if err != nil {
		return flow360.PreflightResult{}, nil, err
	}
	preflight, err := s.flow360.PreflightSimulationParams(ctx, proposal.SourceType, proposal.Target, merged)
	return preflight, merged, err
}

func planAssistRepairPrompt(request planComposerRequest, proposal agent.Proposal, preflight flow360.PreflightResult, attempt int) string {
	patch, _ := json.Marshal(proposal.Patch)
	issues, _ := json.Marshal(preflight.Issues)
	return fmt.Sprintf(`Your candidate Flow360 parameter patch did not pass schema preflight. Repair it now.
Return exactly one create-plan proposal containing the COMPLETE corrected patch for the same %s-to-%s route. Use the newly supplied stage schema, which reflects the candidate model variants. Resolve every listed issue rather than merely describing it. Preserve valid candidate values. JSON merge-patch semantics apply: set an obsolete inherited field to null when Flow360 reports it as extra or forbidden. Do not request user input for a schema-mechanical correction such as a missing required field, renamed field, discriminator-dependent field, or removal of a field from the previous model variant.

Use the language of the Original intent for all human-readable response text. Keep AgentAction JSON keys, enum values, and SimulationParams paths unchanged.

Original intent: %s
Repair attempt: %d
Candidate patch: %s
Flow360 preflight issues: %s`, request.SourceType, request.Target, request.Intent, attempt, patch, issues)
}

func recommendedPlanAssistPatch(schema, current json.RawMessage) (json.RawMessage, bool, error) {
	var root map[string]any
	if !json.Valid(schema) || json.Unmarshal(schema, &root) != nil {
		return nil, false, errors.New("Flow360 recommendation schema is invalid")
	}
	values, applied := recommendedPlanAssistValues(root)
	if !applied {
		return nil, false, nil
	}
	payload, err := json.Marshal(values)
	if err != nil {
		return nil, false, err
	}
	if err := plans.ValidateFormValues(schema, payload); err != nil {
		return nil, false, err
	}
	expanded, err := plans.ExpandFormValues(schema, payload, current)
	if err != nil {
		return nil, false, err
	}
	return expanded, true, nil
}

func recommendedPlanAssistValues(node map[string]any) (map[string]any, bool) {
	nodeType, _ := node["type"].(string)
	if nodeType == "field_removal" {
		recommendation, _ := node["recommendation"].(map[string]any)
		confidence, _ := recommendation["confidence"].(string)
		if confidence == "high" {
			// A typed nil map marshals as JSON null. ExpandFormValues preserves
			// that tombstone so JSON merge-patch removes the rejected field.
			return nil, true
		}
		return nil, false
	}
	if nodeType == "entity_assignment" {
		recommendation, _ := node["recommendation"].(map[string]any)
		confidence, _ := recommendation["confidence"].(string)
		model, _ := node["default_model"].(string)
		entities, _ := node["default_entities"].([]any)
		if confidence == "high" && model != "" && len(entities) > 0 {
			return map[string]any{"model": model, "entities": entities}, true
		}
		return nil, false
	}
	properties, _ := node["properties"].(map[string]any)
	result := map[string]any{}
	applied := false
	for key, raw := range properties {
		child, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		value, childApplied := recommendedPlanAssistValues(child)
		if childApplied {
			result[key] = value
			applied = true
		}
	}
	return result, applied
}

func mergePlanAssistPatches(base, addition json.RawMessage) (json.RawMessage, error) {
	var baseObject map[string]any
	var additionObject map[string]any
	if json.Unmarshal(base, &baseObject) != nil || json.Unmarshal(addition, &additionObject) != nil {
		return nil, errors.New("AI parameter patch is invalid")
	}
	merged := mergePlanAssistObjects(baseObject, additionObject)
	return json.Marshal(merged)
}

func mergePlanAssistObjects(base, addition map[string]any) map[string]any {
	result := make(map[string]any, len(base)+len(addition))
	for key, value := range base {
		result[key] = value
	}
	for key, value := range addition {
		additionChild, additionIsObject := value.(map[string]any)
		baseChild, baseIsObject := result[key].(map[string]any)
		if additionIsObject && baseIsObject {
			result[key] = mergePlanAssistObjects(baseChild, additionChild)
			continue
		}
		result[key] = value
	}
	return result
}

func planAssistPrompt(request planComposerRequest) string {
	return fmt.Sprintf(`Fill the active Flow360 plan form for an EXISTING %s resource from the user's engineering intent.
This is parameter assistance, not geometry generation. Never claim CAD dimensions, format, topology, or provenance unless they are explicitly present in the supplied context. Refer to it as the existing %s resource when evidence is absent.

Return exactly one create-plan proposal when the requested values can be supported. The proposal must use source type %s and target %s, and its patch may only contain fields from the supplied stage schema catalog. Preserve inherited values unless the user asks to change them.

Read the schema catalog field-by-field before composing the patch. Each catalog entry supplies its owning stage, exact dot path, wire type, constraints, units/options, union variants, and sometimes an evidence-backed recommendation. Convert dot paths into nested JSON objects exactly; quantities use {"value":...,"units":"..."}; enum and boundary model values must exactly match the catalog. For a union, choose one supplied variant and emit only the child keys that variant declares. Never invent a nearby field name from memory. If the intent mentions a parameter absent from the active catalog, preserve the baseline and explain or request input instead of fabricating a key.

Build a coherent setup across all active stages, not a bag of unrelated defaults: relate operating conditions to geometry scale and physical models; relate mesh sizes and boundary layers to the intended fidelity; choose steady versus unsteady time stepping from the phenomenon the user wants to observe; and request outputs needed to judge that objective. Keep inherited valid model blocks intact. Use sparse merge-patch semantics and include only deliberate changes.

When the User form instruction includes Flow360 validation errors or remote logs, diagnose them and return a concrete corrective patch. Prefer the safest reversible schema-valid correction supported by the supplied evidence. Do not ask the user to choose a schema mechanism or repeatedly confirm the same boundary/model decision; reserve a question for genuinely missing physical intent with no defensible repair.

For a Geometry-to-Case route, never introduce a Periodic boundary model unless the supplied source evidence explicitly proves that the paired surfaces come from an already reviewed conformal VolumeMesh with identical node counts. Geometry CAD pairing alone is not that evidence. Preserve or choose schema-supported symmetry boundaries for a safe baseline; a Periodic study must begin from a compatible reviewed VolumeMesh.

When the user asks for a basic, baseline, demonstration, or first-pass simulation, choose defensible reviewable defaults for missing operating, meshing, physical-model, and steady/unsteady settings when the active schemas support them. Put every inferred value in assumptions and explain the engineering consequence in the message. Preserve schema-valid infrastructure and entity assignments already supplied by the source resource unless the active schema or a real preflight issue requires changing them. Ask a focused question only when the choice would materially change geometry, make the setup invalid, or has no defensible baseline. Do not turn every unspecified preference into a blocking question, and never ask the user to perform a schema-mechanical correction.

Use the language of the Plan intent and User form instruction for all human-readable response text. Keep AgentAction JSON keys, enum values, and SimulationParams paths unchanged.

Plan intent: %s
User form instruction: %s`, request.SourceType, request.SourceType, request.SourceType, request.Target, request.Intent, request.Prompt)
}

func bindPlanComposerRequest(c *gin.Context) (planComposerRequest, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPlanComposerRequestBytes)
	var request planComposerRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "plan form request is too large"})
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid plan form request"})
		}
		return planComposerRequest{}, false
	}
	request.ProjectID = strings.TrimSpace(request.ProjectID)
	request.ProjectName = strings.TrimSpace(request.ProjectName)
	request.SourceID = strings.TrimSpace(request.SourceID)
	request.SourceType = strings.TrimSpace(request.SourceType)
	request.SourceName = strings.TrimSpace(request.SourceName)
	request.Target = strings.TrimSpace(request.Target)
	request.Intent = strings.TrimSpace(request.Intent)
	request.Prompt = strings.TrimSpace(request.Prompt)
	if request.ProjectID == "" || request.SourceID == "" || request.SourceType == "" || request.Target == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project, source resource, source type, and target are required"})
		return planComposerRequest{}, false
	}
	if len(request.Patch) == 0 {
		request.Patch = json.RawMessage(`{}`)
	}
	if len(request.ConfirmedInputs) > 0 {
		var confirmed map[string]any
		if !json.Valid(request.ConfirmedInputs) || json.Unmarshal(request.ConfirmedInputs, &confirmed) != nil || confirmed == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "confirmed engineering inputs must be a JSON object"})
			return planComposerRequest{}, false
		}
	}
	return request, true
}

func (s *Server) loadPlanComposerContext(ctx context.Context, request planComposerRequest) (planComposerContext, error) {
	detail, err := s.flow360.ResourceDetail(ctx, request.SourceType, request.SourceID)
	if err != nil {
		return planComposerContext{}, err
	}
	if len(detail.SimulationParams) == 0 {
		return planComposerContext{}, errors.New("Flow360 source SimulationParams are unavailable")
	}
	var info struct {
		ProjectID string `json:"project_id"`
		Name      string `json:"name"`
	}
	if len(detail.Info) == 0 || json.Unmarshal(detail.Info, &info) != nil {
		return planComposerContext{}, errors.New("Flow360 source metadata is unavailable")
	}
	if info.ProjectID != request.ProjectID {
		return planComposerContext{}, errors.New("source resource does not belong to this project")
	}
	baseline, err := plans.MergedSimulationParams(plans.Plan{Baseline: detail.SimulationParams, Patch: request.Patch})
	if err != nil {
		return planComposerContext{}, err
	}
	form, err := s.flow360.PlanFormSchema(ctx, detail.Type, request.Target, baseline)
	if err != nil {
		return planComposerContext{}, err
	}
	request.SourceType = detail.Type
	return planComposerContext{Request: request, Name: info.Name, Baseline: baseline, Form: form}, nil
}

type promptSchemaField struct {
	Stage           string `json:"stage"`
	Path            string `json:"path"`
	Type            string `json:"type"`
	Title           string `json:"title,omitempty"`
	Description     string `json:"description,omitempty"`
	Required        bool   `json:"required,omitempty"`
	Unit            string `json:"unit,omitempty"`
	UnitOptions     []any  `json:"unit_options,omitempty"`
	Options         []any  `json:"options,omitempty"`
	Default         any    `json:"default,omitempty"`
	Minimum         any    `json:"minimum,omitempty"`
	Maximum         any    `json:"maximum,omitempty"`
	ModelChoices    []any  `json:"model_choices,omitempty"`
	DefaultModel    string `json:"default_model,omitempty"`
	DefaultEntities []any  `json:"default_entities,omitempty"`
	Recommendation  any    `json:"recommendation,omitempty"`
	Variants        []any  `json:"variants,omitempty"`
}

func schemaPromptCatalog(form flow360.PlanFormSchema) (json.RawMessage, error) {
	fields := make([]promptSchemaField, 0, 128)
	for _, stage := range form.Stages {
		var root map[string]any
		if err := json.Unmarshal(form.Schemas[stage], &root); err != nil {
			return nil, err
		}
		collectPromptSchemaFields(stage, "", root, &fields, 320)
	}
	return json.Marshal(map[string]any{"stages": form.Stages, "fields": fields})
}

func combinedPlanFormSchema(form flow360.PlanFormSchema) (json.RawMessage, error) {
	root := map[string]any{"type": "object", "properties": map[string]any{}, "required": []any{}}
	for _, stage := range form.Stages {
		var schema map[string]any
		if err := json.Unmarshal(form.Schemas[stage], &schema); err != nil {
			return nil, err
		}
		root = mergeSchemaObjects(root, schema)
	}
	return json.Marshal(root)
}

func mergeSchemaObjects(base, addition map[string]any) map[string]any {
	result := make(map[string]any, len(base)+len(addition))
	for key, value := range base {
		result[key] = value
	}
	for key, value := range addition {
		if key == "properties" {
			baseProperties, _ := result[key].(map[string]any)
			additionProperties, _ := value.(map[string]any)
			merged := make(map[string]any, len(baseProperties)+len(additionProperties))
			for property, schema := range baseProperties {
				merged[property] = schema
			}
			for property, schema := range additionProperties {
				if existing, ok := merged[property].(map[string]any); ok {
					if next, ok := schema.(map[string]any); ok && existing["type"] == "object" && next["type"] == "object" {
						merged[property] = mergeSchemaObjects(existing, next)
						continue
					}
				}
				merged[property] = schema
			}
			result[key] = merged
			continue
		}
		if _, exists := result[key]; !exists {
			result[key] = value
		}
	}
	return result
}

func collectPromptSchemaFields(stage, path string, node map[string]any, fields *[]promptSchemaField, limit int) {
	if len(*fields) >= limit {
		return
	}
	nodeType, _ := node["type"].(string)
	if properties, ok := node["properties"].(map[string]any); ok {
		keys := make([]string, 0, len(properties))
		for key := range properties {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			raw := properties[key]
			child, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			childPath := key
			if path != "" {
				childPath = path + "." + key
			}
			collectPromptSchemaFields(stage, childPath, child, fields, limit)
			if len(*fields) >= limit {
				return
			}
		}
		return
	}
	if path == "" || nodeType == "" {
		return
	}
	field := promptSchemaField{Stage: stage, Path: path, Type: nodeType}
	field.Title, _ = node["title"].(string)
	field.Description, _ = node["description"].(string)
	field.Required, _ = node["required"].(bool)
	field.Unit, _ = node["unit"].(string)
	field.Default = node["default"]
	field.Minimum = node["minimum"]
	field.Maximum = node["maximum"]
	if valueSchema, ok := node["value_schema"].(map[string]any); ok {
		if field.Minimum == nil {
			field.Minimum = valueSchema["minimum"]
		}
		if field.Maximum == nil {
			field.Maximum = valueSchema["maximum"]
		}
	}
	if unitOptions, ok := node["unit_options"].([]any); ok && len(unitOptions) <= 20 {
		field.UnitOptions = unitOptions
	}
	if options, ok := node["options"].([]any); ok && len(options) <= 24 {
		field.Options = options
	}
	if variants, ok := node["variants"].([]any); ok && len(variants) <= 8 {
		field.Variants = variants
	}
	if choices, ok := node["model_choices"].([]any); ok && len(choices) <= 16 {
		field.ModelChoices = choices
	}
	field.DefaultModel, _ = node["default_model"].(string)
	if entities, ok := node["default_entities"].([]any); ok && len(entities) <= 40 {
		field.DefaultEntities = entities
	}
	field.Recommendation = node["recommendation"]
	*fields = append(*fields, field)
}
