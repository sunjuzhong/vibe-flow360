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
	Action    agent.Action             `json:"action"`
	Proposal  *agent.Proposal          `json:"proposal,omitempty"`
	Preflight *flow360.PreflightResult `json:"preflight,omitempty"`
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
	if len(action.Proposals) != 1 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "AI form filling must return exactly one proposal"})
		return
	}
	proposal := action.Proposals[0]
	if proposal.SourceType != composer.Request.SourceType || proposal.Target != composer.Request.Target {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "AI proposal does not match the active source-to-target route"})
		return
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
	activeSchema, err := combinedPlanFormSchema(composer.Form)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not combine the active Flow360 stage schemas"})
		return
	}
	if err := plans.ValidateFormValues(activeSchema, proposal.Patch); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "AI form values do not match the active Flow360 schema: " + err.Error()})
		return
	}

	compiled, err := plans.Compile(plans.CreateInput{
		ProjectID: proposal.ProjectID, ProjectName: proposal.ProjectName,
		SourceID: proposal.SourceID, SourceType: proposal.SourceType, SourceName: proposal.SourceName,
		Target: proposal.Target, Name: proposal.Name, Intent: proposal.Intent,
		Patch: proposal.Patch, Baseline: composer.Baseline,
	})
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "AI form values could not be compiled: " + err.Error()})
		return
	}
	merged, err := plans.MergedSimulationParams(compiled)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	preflight, err := s.flow360.PreflightSimulationParams(c.Request.Context(), proposal.SourceType, proposal.Target, merged)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI form values could not be checked with Flow360: " + err.Error()})
		return
	}
	preflight.EditorSchemas = nil
	action.Proposals[0] = proposal
	c.JSON(http.StatusOK, planAssistResponse{Action: *action, Proposal: &proposal, Preflight: &preflight})
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
