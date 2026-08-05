package agent

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

const (
	maxProjectContextBytes = 4000
	// Case SimulationParams commonly exceed a few kilobytes once models,
	// boundaries, outputs, and time stepping are present. Keep enough of the
	// source snapshot for plan composition so the Agent does not ask users for
	// values that are already available on the resource.
	maxSimulationParamsBytes  = 48000
	maxSchemaBytes            = 24000
	maxEvidenceBytes          = 4000
	maxResourceInventoryBytes = 12000
	maxUserFeedbackBytes      = 2000
	maxHistoryTurns           = 20
	maxUserMessageBytes       = 4000
)

var tripleBacktick = "`" + "`" + "`"

func AgentSystemPrompt() string {
	return `You are Vibe Flow360, a careful CFD copilot for Flow360.
Help the user understand the current Project/resource, answer related CFD questions, assess evidence, and translate requested changes into an auditable CFD simulation plan.
For explanatory or diagnostic questions, answer directly in concise Markdown. Do not force a plan when the user only wants understanding.
When the user asks to create or change a simulation, communicate through the STRUCTURED ACTION PROTOCOL below.

## AgentAction v1 Output Contract

When the user's intent requires a plan or missing engineering input, you MUST respond with a valid JSON object inside a fenced code block:

` + tripleBacktick + `json
{
  "version": "v1",
  "kind": "create-plan",
  "message": "Human-readable summary of the plan",
  "proposals": [...],
  "questions": [...],
  "warnings": [...],
  "assumptions": [...]
}
` + tripleBacktick + `

### When to use each action kind:

1. **create-plan**: Use when you have enough information to propose concrete simulation plan(s). Each proposal includes:
   - id: unique identifier
   - action: source resource type (Geometry/SurfaceMesh/VolumeMesh/Case)
   - target: target stage (surface-mesh/volume-mesh/case)
   - name: descriptive plan name
   - intent: engineering objective
   - patch: valid JSON merge-patch for SimulationParams
   - branch_preview: short slug for the branch
   - fields: an ARRAY of objects. Every object must have exactly this shape:
     {"key":"SimulationParams path","value":<JSON value>,"provenance":"provided|derived|inferred|defaulted","description":"optional explanation"}
     Never return fields as a JSON object or map. Use [] when there are no fields.

2. **request-missing-input**: Use when critical information is missing. Ask specific questions:
   - field: the SimulationParams path that needs input
   - message: what the user needs to provide
   - urgency: required/recommended/optional
   - reason: why this matters
   - type: text/number/select/boolean (default to text only when a structured type is not possible)
   - unit, default, min, max, and placeholder when relevant
   - options: [{"value":"stable-id","label":"Human label"}] for select questions
   Ask at most six focused questions per turn. Prefer number, select, and boolean controls over free text.

### Rules:
- Always distinguish user-provided values from assumptions.
- Treat STEP/STP, IGES, CAX, and CATIA as CAD/B-rep Geometry inputs supported by the current Flow360 client. A kernel-native BREP may be exact CAD but must be exported to a client-supported interchange format such as STEP before upload. Treat STL/OBJ and other triangle meshes as tessellated assets, never as exact CAD Geometry.
- Never rename or wrap a tessellated mesh as STEP/BREP. Only claim generated CAD when an audited CAD kernel produced and validated analytic topology; otherwise request a supported CAD upload.
- Route a tessellated asset to a SurfaceMesh workflow only when its format, watertightness, boundary semantics, and Flow360 support have been verified.
- Never claim that a simulation was submitted, run, converged, or completed unless tool evidence is present.
- You cannot execute Flow360 in this chat endpoint. Say that the plan must be reviewed and approved before billable execution.
- If unsure, use request-missing-input rather than guessing.
- Keep the action JSON compact — only include fields that matter.
- Match the language of the user's latest request. Use that language for all explanatory text and human-readable string values, including message, questions, warnings, assumptions, and field descriptions. Keep JSON keys, enum values, SimulationParams paths, and protocol identifiers unchanged.

## Context payload format:
You will receive a structured context block with project info, resource details, SimulationParams snapshot, and Flow360 schema preflight. Use this to make informed proposals.`
}

type ChatContextPayload struct {
	ProjectID            string          `json:"project_id,omitempty"`
	ProjectName          string          `json:"project_name,omitempty"`
	SolverVersion        string          `json:"solver_version,omitempty"`
	SourceID             string          `json:"source_id,omitempty"`
	SourceType           string          `json:"source_type,omitempty"`
	SourceName           string          `json:"source_name,omitempty"`
	SourceStatus         string          `json:"source_status,omitempty"`
	Target               string          `json:"target,omitempty"`
	SimulationParams     json.RawMessage `json:"simulation_params,omitempty"`
	ResourceInfo         json.RawMessage `json:"resource_info,omitempty"`
	ResourceState        json.RawMessage `json:"resource_state,omitempty"`
	ResourceSummary      json.RawMessage `json:"resource_summary,omitempty"`
	ResultArtifacts      json.RawMessage `json:"result_artifacts,omitempty"`
	ProjectResources     json.RawMessage `json:"project_resources,omitempty"`
	ActiveDraft          json.RawMessage `json:"active_draft,omitempty"`
	PartialErrors        json.RawMessage `json:"partial_errors,omitempty"`
	ProjectResourceCount int             `json:"project_resource_count,omitempty"`
	ProjectDraftCount    int             `json:"project_draft_count,omitempty"`
	BranchResourceCount  int             `json:"branch_resource_count,omitempty"`
	ExecutionBoundary    string          `json:"execution_boundary,omitempty"`
	PreflightIssues      []string        `json:"preflight_issues,omitempty"`
	FormSchema           json.RawMessage `json:"form_schema,omitempty"`
	Boundaries           []string        `json:"boundaries,omitempty"`
	RecentLogs           string          `json:"recent_logs,omitempty"`
}

func BuildChatPrompt(request ChatRequest) (string, ChatContextPayload) {
	payload := ChatContextPayload{}

	if strings.TrimSpace(request.Context) != "" {
		payload = parseContextPayload(request.Context)
	}

	var sb strings.Builder
	sb.WriteString("## User Request\n")
	sb.WriteString(truncate(request.Message, maxUserMessageBytes))
	sb.WriteString("\n\n## Structured Context\n")

	contextJSON, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		sb.WriteString("(context serialization failed)\n")
	} else {
		sb.WriteString(string(contextJSON))
		sb.WriteString("\n")
	}

	if len(request.History) > 0 {
		sb.WriteString("\n## Conversation History (latest ")
		turns := request.History
		if len(turns) > maxHistoryTurns {
			turns = turns[len(turns)-maxHistoryTurns:]
		}
		sb.WriteString(fmt.Sprintf("%d turns)\n", len(turns)))
		for _, msg := range turns {
			sb.WriteString(fmt.Sprintf("%s: %s\n",
				strings.ToUpper(msg.Role),
				truncate(msg.Content, 500)))
		}
	}

	sb.WriteString("\nRespond in the same language as the User Request above. Answer directly for explanation or analysis. Use an AgentAction v1 JSON object in a fenced code block only when proposing a plan or requesting inputs for one; keep its protocol keys and enum values unchanged.")
	return sb.String(), payload
}

func parseContextPayload(contextStr string) ChatContextPayload {
	var payload ChatContextPayload
	if err := json.Unmarshal([]byte(contextStr), &payload); err == nil {
		payload.SimulationParams = truncateRaw(payload.SimulationParams, maxSimulationParamsBytes)
		payload.FormSchema = truncateRaw(payload.FormSchema, maxSchemaBytes)
		payload.ResourceInfo = truncateRaw(payload.ResourceInfo, maxEvidenceBytes)
		payload.ResourceState = truncateRaw(payload.ResourceState, maxEvidenceBytes)
		payload.ResourceSummary = truncateRaw(payload.ResourceSummary, maxEvidenceBytes)
		payload.ResultArtifacts = truncateRaw(payload.ResultArtifacts, maxResourceInventoryBytes)
		payload.ProjectResources = truncateRaw(payload.ProjectResources, maxResourceInventoryBytes)
		payload.ActiveDraft = truncateRaw(payload.ActiveDraft, maxSimulationParamsBytes)
		payload.PartialErrors = truncateRaw(payload.PartialErrors, maxEvidenceBytes)
		payload.RecentLogs = truncate(payload.RecentLogs, maxEvidenceBytes)
		payload.ProjectName = truncate(payload.ProjectName, 200)
		payload.SourceName = truncate(payload.SourceName, 200)
		payload.SolverVersion = truncate(payload.SolverVersion, 100)
		payload.SourceStatus = truncate(payload.SourceStatus, 100)
		payload.ExecutionBoundary = truncate(payload.ExecutionBoundary, 300)
		return payload
	}

	payload.ProjectName = ""
	payload.ProjectID = ""
	parts := strings.Split(contextStr, " ")
	for _, part := range parts {
		kv := strings.SplitN(part, ":", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "project":
			payload.ProjectID = truncate(kv[1], 100)
		case "resource":
			payload.SourceID = truncate(kv[1], 100)
		case "plan":
			payload.SourceID = truncate(kv[1], 100)
		}
	}
	return payload
}

func truncate(s string, maxBytes int) string {
	s = strings.ToValidUTF8(s, "\uFFFD")
	if maxBytes <= 0 {
		return ""
	}
	if len(s) <= maxBytes {
		return s
	}
	const suffix = "...(truncated)"
	if maxBytes <= len(suffix) {
		return suffix[:maxBytes]
	}
	cut := maxBytes - len(suffix)
	for cut > 0 && !utf8.ValidString(s[:cut]) {
		cut--
	}
	return s[:cut] + suffix
}

func truncateRaw(raw json.RawMessage, maxBytes int) json.RawMessage {
	if len(raw) <= maxBytes {
		return raw
	}
	preview := truncate(string(raw), maxBytes-128)
	wrapped, err := json.Marshal(map[string]any{
		"_truncated": true,
		"preview":    preview,
	})
	if err != nil {
		return json.RawMessage(`{"_truncated":true}`)
	}
	return wrapped
}

type RecoveryPromptInput struct {
	Intervention        Intervention
	Plan                *plans.Plan
	SimulationParams    json.RawMessage
	FormSchema          json.RawMessage
	BoundaryGroups      []string
	UserHistoryFeedback string
	RecentLogs          string
}

func BuildRecoveryPrompt(input RecoveryPromptInput) (string, ChatContextPayload) {
	ctx := ChatContextPayload{
		ProjectID:   input.Intervention.ProjectID,
		ProjectName: input.Intervention.ProjectName,
		SourceID:    input.Intervention.ResourceID,
		SourceType:  input.Intervention.ResourceType,
		SourceName:  "",
		Target:      "",
		Boundaries:  input.BoundaryGroups,
		RecentLogs:  truncate(input.RecentLogs, maxEvidenceBytes),
	}

	if input.Plan != nil {
		ctx.SourceName = input.Plan.SourceName
		ctx.Target = input.Plan.Target
		if len(input.Plan.Patch) > 0 {
			ctx.SimulationParams = truncateRaw(input.Plan.Patch, maxSimulationParamsBytes)
		}
		if input.Plan.Preflight != nil {
			var issues []string
			for _, iss := range input.Plan.Preflight.Issues {
				issues = append(issues, fmt.Sprintf("[%s] %s: %s", iss.Level, iss.Path, iss.Message))
			}
			ctx.PreflightIssues = issues
			if len(input.Plan.Preflight.FormSchema) > 0 {
				ctx.FormSchema = truncateRaw(input.Plan.Preflight.FormSchema, maxSchemaBytes)
			}
		}
	}

	if len(input.SimulationParams) > 0 && len(ctx.SimulationParams) == 0 {
		ctx.SimulationParams = truncateRaw(input.SimulationParams, maxSimulationParamsBytes)
	}
	if len(input.FormSchema) > 0 && len(ctx.FormSchema) == 0 {
		ctx.FormSchema = truncateRaw(input.FormSchema, maxSchemaBytes)
	}
	input.UserHistoryFeedback = truncate(input.UserHistoryFeedback, maxUserFeedbackBytes)

	evidenceSummary := summarizeEvidence(input.Intervention.Evidence)
	diagnosisSummary := formatDiagnosisForPrompt(input.Intervention.Diagnosis)

	var sb strings.Builder
	sb.WriteString(`You are the Vibe Flow360 simulation recovery agent.
Analyze the simulation failure and propose structured fix actions.

## Error Context
`)
	sb.WriteString(fmt.Sprintf("- **Intervention Type**: %s\n", input.Intervention.Type))
	sb.WriteString(fmt.Sprintf("- **Error Reason**: %s\n", truncate(input.Intervention.Reason, 500)))
	sb.WriteString(fmt.Sprintf("- **Evidence Summary**: %s\n", truncate(evidenceSummary, maxEvidenceBytes)))
	sb.WriteString(fmt.Sprintf("- **Diagnosis**: %s\n", diagnosisSummary))
	sb.WriteString(fmt.Sprintf("- **Plan ID**: %s (revision %d)\n", input.Intervention.PlanID, input.Intervention.PlanRevision))

	if input.UserHistoryFeedback != "" {
		sb.WriteString(fmt.Sprintf("- **User Feedback History**: %s\n", input.UserHistoryFeedback))
	}

	sb.WriteString("\n## Simulation Context\n")
	contextJSON, err := json.MarshalIndent(ctx, "", "  ")
	if err != nil {
		sb.WriteString("(context serialization failed)\n")
	} else {
		sb.WriteString(string(contextJSON))
		sb.WriteString("\n")
	}

	sb.WriteString(`
## Task
Propose fix actions as an AgentAction v1 JSON object with:
- kind: "create-plan" when the available evidence is sufficient
- kind: "request-missing-input" when a consequential engineering value is unknown; include typed questions for a dynamic form
- Each proposal should include specific parameter changes in the patch field
- Include reasoning and confidence in the fields
- If user feedback is present, use its language for all human-readable text. Otherwise, use the language of the error reason. Keep JSON protocol keys and enum values unchanged.

Respond with the JSON object in a fenced code block.`)

	return sb.String(), ctx
}

func ExtractAndValidateAction(response string) (Action, error) {
	jsonStr := extractJSONBlock(response)
	if jsonStr == "" {
		return Action{}, ErrInvalidJSON
	}
	return Parse(jsonStr)
}

func extractJSONBlock(text string) string {
	patterns := []string{
		tripleBacktick + "json\n",
		tripleBacktick + "JSON\n",
		tripleBacktick + "\n",
	}
	for _, prefix := range patterns {
		idx := strings.Index(text, prefix)
		if idx == -1 {
			continue
		}
		start := idx + len(prefix)
		end := strings.Index(text[start:], tripleBacktick)
		if end != -1 {
			return strings.TrimSpace(text[start : start+end])
		}
	}

	firstBrace := strings.Index(text, "{")
	lastBrace := strings.LastIndex(text, "}")
	if firstBrace != -1 && lastBrace != -1 && firstBrace < lastBrace {
		return strings.TrimSpace(text[firstBrace : lastBrace+1])
	}
	return ""
}
