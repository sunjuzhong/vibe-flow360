package agent

import (
	"encoding/json"
	"fmt"
	"sort"
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
	maxSchemaBytes            = 65536
	maxEvidenceBytes          = 4000
	maxConfirmedInputsBytes   = 12000
	maxRuntimeSkillsBytes     = 16000
	maxResourceInventoryBytes = 12000
	maxUserFeedbackBytes      = 2000
	maxHistoryTurns           = 20
	maxUserMessageBytes       = 4000
	maxActionResponseBytes    = 256 << 10
	maxActionJSONCandidates   = 16
	maxActionUnwrapDepth      = 4
	maxActionUnwrapValues     = 64
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
   - changes: normally use patch with a valid JSON merge-patch for SimulationParams. When the caller explicitly requests path-level parameter operations, omit patch and provide operations instead.
   - operations: an ARRAY of bounded parameter operations. Generic operations use {"op":"set|unset|append","path":"/RFC6901/pointer","value":...}; set and append require value and unset omits it. When the engineering request requires a new plane-based Case output and the active schema exposes SliceOutput plus the requested fields, use the typed operation {"op":"create-slice-output","origin":[x,y,z],"normal":[nx,ny,nz],"name":"optional","output_fields":["schema-enum"]}. Coordinates are numeric values in the Project length unit. The application creates and registers the Slice entity atomically; never emit private_attribute paths, private IDs, or a separate generic append for that SliceOutput. Never provide both patch and operations.
   - branch_preview: short slug for the branch
   - fields: an ARRAY of objects. Every object must have exactly this shape:
     {"key":"SimulationParams path","value":<JSON value>,"provenance":"provided|derived|inferred|defaulted","description":"optional explanation"}
     Never return fields as a JSON object or map. Use [] when there are no fields.

2. **update-draft**: Use only when scope_type is "draft" and the user asks to modify the current Draft without running it. Return exactly one proposal with:
   - id: unique proposal identifier
   - draft_id: the current scope_id
   - target: "draft"
   - name and intent: concise descriptions of this edit
   - changes: follow the caller's requested representation. For path-level editing, provide operations and omit patch; otherwise provide a sparse patch.
   - fields: the same provenance array used by create-plan
   This action only proposes an editable Draft change. It never starts meshing or a solver.

3. **request-missing-input**: Use when critical information is missing. Ask specific questions:
   - field: the SimulationParams path that needs input
   - message: what the user needs to provide
   - urgency: required/recommended/optional
   - reason: why this matters
   - type: text/number/select/boolean (default to text only when a structured type is not possible)
   - unit, default, min, max, and placeholder when relevant
   - recommendation: concise engineering reason for the proposed default
   - options: [{"value":"stable-id","label":"Human label"}] for select questions
   Ask at most six focused questions per turn. Prefer number, select, and boolean controls over free text. Always emit an explicit type. Whenever the current Project/resource evidence supports a safe choice, provide a recommended default and its recommendation so the user can confirm instead of entering it manually. Do not invent geometry or consequential physics; omit the default when evidence is insufficient.

### Rules:
- Always distinguish user-provided values from assumptions.
- Treat STEP/STP, IGES, CAX, and CATIA as CAD/B-rep Geometry inputs supported by the current Flow360 client. A kernel-native BREP may be exact CAD but must be exported to a client-supported interchange format such as STEP before upload. Treat STL/OBJ and other triangle meshes as tessellated assets, never as exact CAD Geometry.
- Never rename or wrap a tessellated mesh as STEP/BREP. Only claim generated CAD when an audited CAD kernel produced and validated analytic topology; otherwise request a supported CAD upload.
- Route a tessellated asset to a SurfaceMesh workflow only when its format, watertightness, boundary semantics, and Flow360 support have been verified.
- Never claim that a simulation was submitted, run, converged, or completed unless tool evidence is present.
- You cannot execute Flow360 in this chat endpoint. Say that the plan must be reviewed and approved before billable execution.
- In Draft scope, prefer update-draft over create-plan when the user asks only to change the current Draft. Do not claim the patch was saved until the application reports success.
- If a consequential physical choice remains genuinely unknown after checking confirmed_inputs, the canonical baseline, and schema recommendations, use request-missing-input rather than guessing. Do not use request-missing-input for configuration mechanics or to reconfirm a defensible recommended default in an autonomous basic/ready-to-run workflow.
- Keep the action JSON compact — only include fields that matter.
- Treat form_schema as the authoritative catalog for the installed Flow360 version. Use only listed SimulationParams paths, exact enum/model values, documented quantity units, and the required {"value": number, "units": "unit"} wire shape. Never translate a human CFD term into a guessed snake_case field.
- Preserve the supplied SimulationParams as the canonical baseline. Return the requested sparse change representation, never a replacement document. When path-level operations are requested, use operations only and never replace a complex object array. Otherwise return a sparse merge-patch. Do not copy private_attribute fields unless an active schema field explicitly supplies the entity payload.
- Use create-slice-output only when the user's engineering objective requires sampling requested Case fields on a newly defined plane. Derive the plane origin and normal from the user's coordinates and orientation, and use only output field enum values exposed by the active schema. Use ordinary set/unset/append for all other edits and for outputs that reference already registered entities.
- Canonical SimulationParams can contain internal discriminator keys that the editable form intentionally omits. Do not echo type_name or any other baseline-only child into a quantity/object patch unless that exact child path appears in form_schema.
- Respect stage ownership: SurfaceMesh fields configure surface meshing, VolumeMesh fields configure volume meshing, and Case fields configure physics, operating condition, time stepping, numerics, and outputs. Do not put a valid concept under the wrong stage path.
- When a schema field exposes recommendation/default_model/default_entities with high confidence, prefer that evidence-backed value and record it as derived or defaulted. Exact schema and preflight errors override general CFD memory.
- Treat confirmed_inputs as authoritative. Never ask for a value already present there. In an autonomous AI Create request, select a supplied recommended default yourself for a basic or ready-to-run case; request input only when no defensible default exists and the choice materially changes the engineering objective.
- Match the language of the user's latest request. Use that language for all explanatory text and human-readable string values, including message, questions, warnings, assumptions, and field descriptions. Keep JSON keys, enum values, SimulationParams paths, and protocol identifiers unchanged.
- Treat scope_type and scope_id as the primary identity of this conversation. A Draft scope and its source Resource scope are separate conversations even when they share the same source_id.
- You may use project_resources and project_drafts as the read-only Project context catalog to reason across branches and refer to other Resources or Drafts by stable ID. Never associate them by display name. The current scope remains primary; when another catalog entry lacks detailed evidence, state that limitation instead of inventing its parameters or results.
- Follow runtime_skills as stage-specific procedural guidance. Live Flow360 schemas, entity payloads, canonical SimulationParams, and preflight diagnostics remain the authoritative executable contracts when general guidance conflicts with them.

## Context payload format:
You will receive a structured context block with project info, resource details, SimulationParams snapshot, and Flow360 schema preflight. Use this to make informed proposals.`
}

type ChatContextPayload struct {
	ProjectID            string          `json:"project_id,omitempty"`
	ProjectName          string          `json:"project_name,omitempty"`
	SolverVersion        string          `json:"solver_version,omitempty"`
	ScopeType            string          `json:"scope_type,omitempty"`
	ScopeID              string          `json:"scope_id,omitempty"`
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
	ProjectDrafts        json.RawMessage `json:"project_drafts,omitempty"`
	ActiveDraft          json.RawMessage `json:"active_draft,omitempty"`
	PartialErrors        json.RawMessage `json:"partial_errors,omitempty"`
	ProjectResourceCount int             `json:"project_resource_count,omitempty"`
	ProjectDraftCount    int             `json:"project_draft_count,omitempty"`
	BranchResourceCount  int             `json:"branch_resource_count,omitempty"`
	ExecutionBoundary    string          `json:"execution_boundary,omitempty"`
	PreflightIssues      []string        `json:"preflight_issues,omitempty"`
	FormSchema           json.RawMessage `json:"form_schema,omitempty"`
	ConfirmedInputs      json.RawMessage `json:"confirmed_inputs,omitempty"`
	RuntimeSkills        string          `json:"runtime_skills,omitempty"`
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
		payload.ConfirmedInputs = truncateRaw(payload.ConfirmedInputs, maxConfirmedInputsBytes)
		payload.RuntimeSkills = truncate(payload.RuntimeSkills, maxRuntimeSkillsBytes)
		payload.ResourceInfo = truncateRaw(payload.ResourceInfo, maxEvidenceBytes)
		payload.ResourceState = truncateRaw(payload.ResourceState, maxEvidenceBytes)
		payload.ResourceSummary = truncateRaw(payload.ResourceSummary, maxEvidenceBytes)
		payload.ResultArtifacts = truncateRaw(payload.ResultArtifacts, maxResourceInventoryBytes)
		payload.ProjectResources = truncateRaw(payload.ProjectResources, maxResourceInventoryBytes)
		payload.ProjectDrafts = truncateRaw(payload.ProjectDrafts, maxResourceInventoryBytes)
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
		if len(input.Plan.Patch) > 0 && len(input.SimulationParams) == 0 {
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

	if len(input.SimulationParams) > 0 {
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
- Never ask the user to paste logs, SimulationParams, remote state, or form_schema. Those are application-owned context and must be inspected from the supplied Simulation Context. Ask a question only for a consequential engineering choice that cannot be derived from that evidence.
- If user feedback is present, use its language for all human-readable text. Otherwise, use the language of the error reason. Keep JSON protocol keys and enum values unchanged.

Respond with the JSON object in a fenced code block.`)

	return sb.String(), ctx
}

func ExtractAndValidateAction(response string) (Action, error) {
	response = strings.TrimSpace(response)
	if response == "" || len(response) > maxActionResponseBytes {
		return Action{}, ErrInvalidJSON
	}
	candidates, limitExceeded := extractJSONCandidates(response)
	if limitExceeded {
		return Action{}, ErrJSONActionLimitExceeded
	}
	if len(candidates) == 0 {
		return Action{}, ErrInvalidJSON
	}

	state := actionDecodeState{
		valid:     make([]Action, 0, 1),
		validKeys: make(map[string]struct{}, 1),
	}
	for _, candidate := range candidates {
		collectValidActions(candidate, 0, &state)
		if state.limitExceeded {
			return Action{}, ErrJSONActionLimitExceeded
		}
		if len(state.valid) > 1 {
			return Action{}, ErrAmbiguousJSONAction
		}
	}
	if len(state.valid) == 1 {
		return state.valid[0], nil
	}
	if state.firstValidationErr != nil {
		return Action{}, state.firstValidationErr
	}
	return Action{}, ErrInvalidJSON
}

func extractJSONCandidates(text string) ([]string, bool) {
	candidates := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)
	limitExceeded := false
	appendCandidate := func(raw string) {
		trimmed, key, ok := canonicalJSONCandidate(raw)
		if !ok {
			return
		}
		if _, duplicate := seen[key]; duplicate {
			return
		}
		seen[key] = struct{}{}
		if len(candidates) >= maxActionJSONCandidates {
			limitExceeded = true
			return
		}
		candidates = append(candidates, trimmed)
	}
	appendCandidate(text)
	for _, fenced := range extractFencedJSONCandidates(text) {
		appendCandidate(fenced)
		for _, nested := range extractBalancedJSONCandidates(fenced) {
			appendCandidate(nested)
		}
	}
	for _, balanced := range extractBalancedJSONCandidates(text) {
		appendCandidate(balanced)
	}
	return candidates, limitExceeded
}

func canonicalJSONCandidate(raw string) (string, string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(trimmed) > maxActionResponseBytes {
		return "", "", false
	}
	var value any
	if json.Unmarshal([]byte(trimmed), &value) != nil {
		return "", "", false
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "", "", false
	}
	return trimmed, string(canonical), true
}

func extractFencedJSONCandidates(text string) []string {
	candidates := make([]string, 0, 1)
	remaining := text
	for {
		open := strings.Index(remaining, tripleBacktick)
		if open < 0 {
			break
		}
		bodyStart := open + len(tripleBacktick)
		lineEnd := strings.IndexByte(remaining[bodyStart:], '\n')
		if lineEnd < 0 {
			break
		}
		language := strings.TrimSpace(strings.TrimSuffix(remaining[bodyStart:bodyStart+lineEnd], "\r"))
		bodyStart += lineEnd + 1
		closeOffset := strings.Index(remaining[bodyStart:], tripleBacktick)
		if closeOffset < 0 {
			break
		}
		if language == "" || strings.EqualFold(language, "json") {
			body := strings.TrimSpace(remaining[bodyStart : bodyStart+closeOffset])
			if body != "" && len(body) <= maxActionResponseBytes {
				candidates = append(candidates, body)
			}
		}
		remaining = remaining[bodyStart+closeOffset+len(tripleBacktick):]
	}
	return candidates
}

func extractBalancedJSONCandidates(text string) []string {
	candidates := make([]string, 0, 1)
	start := -1
	stack := make([]byte, 0, 8)
	inString := false
	escaped := false
	for index := 0; index < len(text); index++ {
		current := text[index]
		if start < 0 {
			if current == '{' || current == '[' {
				start = index
				stack = append(stack[:0], current)
			}
			continue
		}
		if inString {
			if escaped {
				escaped = false
			} else if current == '\\' {
				escaped = true
			} else if current == '"' {
				inString = false
			}
			continue
		}
		switch current {
		case '"':
			inString = true
		case '{', '[':
			stack = append(stack, current)
			if len(stack) > 32 {
				start = -1
				stack = stack[:0]
			}
		case '}', ']':
			if len(stack) == 0 || (current == '}' && stack[len(stack)-1] != '{') || (current == ']' && stack[len(stack)-1] != '[') {
				start = -1
				stack = stack[:0]
				continue
			}
			stack = stack[:len(stack)-1]
			if len(stack) == 0 {
				candidate := strings.TrimSpace(text[start : index+1])
				if json.Valid([]byte(candidate)) {
					candidates = append(candidates, candidate)
				}
				start = -1
			}
		}
	}
	return candidates
}

type actionDecodeState struct {
	examined           int
	valid              []Action
	validKeys          map[string]struct{}
	firstValidationErr error
	limitExceeded      bool
}

func collectValidActions(raw string, depth int, state *actionDecodeState) {
	if state.limitExceeded || len(state.valid) > 1 {
		return
	}
	if len(raw) > maxActionResponseBytes {
		state.limitExceeded = true
		return
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return
	}
	collectValidActionValue(value, depth, state)
}

func collectValidActionValue(value any, depth int, state *actionDecodeState) {
	if state.limitExceeded || len(state.valid) > 1 {
		return
	}
	if depth > maxActionUnwrapDepth || state.examined >= maxActionUnwrapValues {
		state.limitExceeded = true
		return
	}
	state.examined++
	switch typed := value.(type) {
	case map[string]any:
		if looksLikeAgentAction(typed) {
			encoded, err := json.Marshal(typed)
			if err != nil {
				return
			}
			action, err := Parse(string(encoded))
			if err == nil {
				key, keyErr := json.Marshal(action)
				if keyErr == nil {
					if _, duplicate := state.validKeys[string(key)]; !duplicate {
						state.validKeys[string(key)] = struct{}{}
						state.valid = append(state.valid, action)
					}
				}
			} else if state.firstValidationErr == nil {
				state.firstValidationErr = err
			}
			return
		}
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			collectValidActionValue(typed[key], depth+1, state)
			if state.limitExceeded || len(state.valid) > 1 {
				return
			}
		}
	case []any:
		for _, item := range typed {
			collectValidActionValue(item, depth+1, state)
			if state.limitExceeded || len(state.valid) > 1 {
				return
			}
		}
	case string:
		decoded := strings.TrimSpace(typed)
		if decoded == "" || len(decoded) > maxActionResponseBytes {
			return
		}
		candidates, limitExceeded := extractJSONCandidates(decoded)
		if limitExceeded {
			state.limitExceeded = true
			return
		}
		for _, candidate := range candidates {
			collectValidActions(candidate, depth+1, state)
			if state.limitExceeded || len(state.valid) > 1 {
				return
			}
		}
	}
}

func looksLikeAgentAction(value map[string]any) bool {
	_, hasKind := value["kind"]
	_, hasMessage := value["message"]
	if hasKind && hasMessage {
		return true
	}
	_, hasProposals := value["proposals"]
	_, hasQuestions := value["questions"]
	return hasProposals || hasQuestions
}
