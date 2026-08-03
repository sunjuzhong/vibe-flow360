package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

const maxPlanComposerRequestBytes = 300 << 10

type planComposerRequest struct {
	ProjectID   string          `json:"project_id"`
	ProjectName string          `json:"project_name,omitempty"`
	SourceID    string          `json:"source_id"`
	SourceType  string          `json:"source_type"`
	SourceName  string          `json:"source_name,omitempty"`
	Target      string          `json:"target"`
	Intent      string          `json:"intent,omitempty"`
	Prompt      string          `json:"prompt,omitempty"`
	Patch       json.RawMessage `json:"patch,omitempty"`
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

	catalog, err := schemaPromptCatalog(composer.Form)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare the active Flow360 schema for the Agent"})
		return
	}
	contextPayload, err := json.Marshal(agent.ChatContextPayload{
		ProjectID: composer.Request.ProjectID, ProjectName: composer.Request.ProjectName,
		SourceID: composer.Request.SourceID, SourceType: composer.Request.SourceType,
		SourceName: composer.Name, Target: composer.Request.Target,
		SimulationParams: composer.Baseline, FormSchema: catalog,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare the plan context"})
		return
	}
	message := planAssistPrompt(composer.Request)
	_, action, err := s.agent.ChatWithValidation(c.Request.Context(), agent.ChatRequest{
		Message: message, Context: string(contextPayload), Session: "web:plan-composer",
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI could not produce schema-valid form values: " + err.Error()})
		return
	}
	if action.Kind == agent.ActionRequestMissingInput {
		c.JSON(http.StatusOK, planAssistResponse{Action: *action})
		return
	}
	activeSchema, err := combinedPlanFormSchema(composer.Form)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not combine the active Flow360 stage schemas"})
		return
	}
	proposal, err := preparePlanAssistProposal(*action, composer, activeSchema)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	preflight, merged, err := s.preflightPlanAssistProposal(c.Request.Context(), composer, proposal)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI form values could not be checked with Flow360: " + err.Error()})
		return
	}

	const maxRepairAttempts = 2
	repairAttempts := 0
	agentRepairAttempts := 0
	autoRepaired := false
	for !preflight.Valid && agentRepairAttempts < maxRepairAttempts {
		if recommendedPatch, applied, recommendationErr := recommendedPlanAssistPatch(preflight.FormSchema, merged); recommendationErr == nil && applied {
			proposal.Patch, err = mergePlanAssistPatches(proposal.Patch, recommendedPatch)
			if err == nil {
				repairAttempts++
				preflight, merged, err = s.preflightPlanAssistProposal(c.Request.Context(), composer, proposal)
				if err == nil && preflight.Valid {
					autoRepaired = true
					break
				}
			}
		}
		agentRepairAttempts++
		repairAttempts++
		repairForm, formErr := s.flow360.PlanFormSchema(c.Request.Context(), proposal.SourceType, proposal.Target, merged)
		if formErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair could not load the schema for the candidate configuration.")
			break
		}
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
		})
		if contextErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair could not prepare the validation context.")
			break
		}
		repairMessage := planAssistRepairPrompt(composer.Request, proposal, preflight, agentRepairAttempts)
		_, repairedAction, repairErr := s.agent.ChatWithValidation(c.Request.Context(), agent.ChatRequest{
			Message: repairMessage, Context: string(repairContext), Session: "web:plan-composer:repair",
		})
		if repairErr != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair stopped because the Agent did not return a valid correction.")
			break
		}
		if repairedAction.Kind == agent.ActionRequestMissingInput {
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
		preflight, merged, err = s.preflightPlanAssistProposal(c.Request.Context(), composer, proposal)
		if err != nil {
			action.Warnings = append(action.Warnings, "Automatic parameter repair could not re-run Flow360 validation.")
			break
		}
		if preflight.Valid {
			autoRepaired = true
		}
	}

	preflight.EditorSchemas = nil
	if action.Kind == agent.ActionCreatePlan && len(action.Proposals) == 1 {
		action.Proposals[0] = proposal
	}
	c.JSON(http.StatusOK, planAssistResponse{
		Action: *action, Proposal: &proposal, Preflight: &preflight,
		RepairAttempts: repairAttempts, AutoRepaired: autoRepaired,
	})
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
	if err := plans.ValidateFormValues(schema, proposal.Patch); err != nil {
		return agent.Proposal{}, errors.New("AI form values do not match the active Flow360 schema: " + err.Error())
	}
	return proposal, nil
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
	if nodeType, _ := node["type"].(string); nodeType == "entity_assignment" {
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

When the user asks for a basic, baseline, demonstration, or first-pass simulation, choose defensible reviewable defaults for missing operating, meshing, physical-model, and steady/unsteady settings when the active schemas support them. Put every inferred value in assumptions and explain the engineering consequence in the message. For external-flow baselines, answer explicitly whether the existing automated farfield/domain treatment is sufficient; do not ask for a physical wind tunnel unless the user requests wall-bounded tunnel effects. Ask a focused question only when the choice would materially change geometry, make the setup invalid, or has no defensible baseline. Do not turn every unspecified preference into a blocking question.

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
	Stage   string `json:"stage"`
	Path    string `json:"path"`
	Type    string `json:"type"`
	Title   string `json:"title,omitempty"`
	Unit    string `json:"unit,omitempty"`
	Options []any  `json:"options,omitempty"`
}

func schemaPromptCatalog(form flow360.PlanFormSchema) (json.RawMessage, error) {
	fields := make([]promptSchemaField, 0, 128)
	for _, stage := range form.Stages {
		var root map[string]any
		if err := json.Unmarshal(form.Schemas[stage], &root); err != nil {
			return nil, err
		}
		collectPromptSchemaFields(stage, "", root, &fields, 180)
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
		for key, raw := range properties {
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
	field.Unit, _ = node["unit"].(string)
	if options, ok := node["options"].([]any); ok && len(options) <= 12 {
		field.Options = options
	}
	*fields = append(*fields, field)
}
