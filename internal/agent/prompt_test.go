package agent

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestAgentSystemPromptDeclaresAgentActionV1(t *testing.T) {
	prompt := AgentSystemPrompt()
	for _, keyword := range []string{"AgentAction v1", "create-plan", "request-missing-input", "version", "proposals", "questions", "STL", "exact CAD", "STEP"} {
		if !strings.Contains(prompt, keyword) {
			t.Errorf("system prompt missing %q", keyword)
		}
	}
}

func TestBuildChatPromptInjectsUserMessageAndContext(t *testing.T) {
	req := ChatRequest{
		Message: "analyze lift at Mach 0.5",
		Context: `{"project_id":"prj-1","source_id":"case-1","source_type":"Case","target":"case","simulation_params":{"mach":0.5}}`,
	}
	prompt, payload := BuildChatPrompt(req)
	if !strings.Contains(prompt, "analyze lift at Mach 0.5") {
		t.Error("prompt missing user message")
	}
	if payload.ProjectID != "prj-1" {
		t.Errorf("expected project_id prj-1, got %q", payload.ProjectID)
	}
	if payload.SourceType != "Case" {
		t.Errorf("expected source_type Case, got %q", payload.SourceType)
	}
	if !strings.Contains(string(payload.SimulationParams), "0.5") {
		t.Error("simulation params not included")
	}
}

func TestBuildChatPromptKeepsProjectResourceCFDContext(t *testing.T) {
	req := ChatRequest{
		Message: "Are these results trustworthy?",
		Context: `{
  "project_id":"prj-1",
  "project_name":"Cylinder Flow",
  "solver_version":"25.10",
  "source_id":"case-1",
  "source_type":"Case",
  "source_name":"Baseline",
  "source_status":"Completed",
  "simulation_params":{"operating_condition":{"velocity_magnitude":40}},
  "resource_info":{"solver":"flow360"},
  "resource_state":{"status":"completed"},
  "resource_summary":{"convergence":"not-converged"},
  "result_artifacts":[{"name":"linear_residual_v2.csv"}],
  "project_resources":[{"id":"geo-1","type":"Geometry"},{"id":"case-1","type":"Case"}],
  "partial_errors":{"logs":"tail unavailable"},
  "project_resource_count":2,
  "branch_resource_count":2
}`,
	}
	prompt, payload := BuildChatPrompt(req)
	if payload.ProjectName != "Cylinder Flow" || payload.SourceStatus != "Completed" {
		t.Fatalf("project/resource identity was not preserved: %#v", payload)
	}
	for _, expected := range []string{"not-converged", "linear_residual_v2.csv", "velocity_magnitude", "tail unavailable", "flow360"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("prompt is missing CFD context %q: %s", expected, prompt)
		}
	}
	if !strings.Contains(prompt, "Answer directly in English") {
		t.Fatalf("chat prompt does not allow direct CFD answers: %s", prompt)
	}
}

func TestBuildChatPromptKeepsTypicalCaseSimulationParams(t *testing.T) {
	largeValue := strings.Repeat("case-parameter-", 1200)
	contextJSON, err := json.Marshal(ChatContextPayload{
		ProjectID:        "prj-1",
		SourceID:         "case-1",
		SourceType:       "Case",
		Target:           "case",
		SimulationParams: json.RawMessage(`{"models":{"snapshot":"` + largeValue + `"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	_, payload := BuildChatPrompt(ChatRequest{Message: "make this case runnable", Context: string(contextJSON)})
	if strings.Contains(string(payload.SimulationParams), "truncated") {
		t.Fatal("a typical Case SimulationParams snapshot should not be truncated")
	}
	if !strings.Contains(string(payload.SimulationParams), largeValue) {
		t.Fatal("the complete Case SimulationParams snapshot was not preserved")
	}
}

func TestBuildChatPromptTruncatesLongMessages(t *testing.T) {
	longMsg := strings.Repeat("x", 8000)
	req := ChatRequest{Message: longMsg}
	prompt, _ := BuildChatPrompt(req)
	if len(prompt) > maxUserMessageBytes+1000 {
		t.Errorf("prompt too long: %d bytes", len(prompt))
	}
}

func TestBuildChatPromptParsesKeyValueContext(t *testing.T) {
	req := ChatRequest{
		Message: "test",
		Context: "project:prj-1 resource:res-2 plan:plan-3",
	}
	_, payload := BuildChatPrompt(req)
	if payload.ProjectID != "prj-1" {
		t.Errorf("expected prj-1, got %q", payload.ProjectID)
	}
	if payload.SourceID != "plan-3" {
		t.Errorf("expected plan-3 as source_id, got %q", payload.SourceID)
	}
}

func TestBuildRecoveryPromptIncludesErrorContext(t *testing.T) {
	intervention := Intervention{
		ProjectID:   "prj-1",
		ProjectName: "Test Project",
		ResourceID:  "res-1",
		PlanID:      "plan-1",
		Type:        TypePreflightError,
		Reason:      "Missing boundary conditions",
		Evidence: []Evidence{
			{
				Type:    "preflight_issue",
				Content: json.RawMessage(`{"message":"boundary group not assigned"}`),
				Source:  "flow360_preflight",
			},
		},
	}

	prompt, payload := BuildRecoveryPrompt(RecoveryPromptInput{
		Intervention: intervention,
	})

	if !strings.Contains(prompt, "Missing boundary conditions") {
		t.Error("prompt missing error reason")
	}
	if !strings.Contains(prompt, "preflight") {
		t.Error("prompt missing intervention type")
	}
	if !strings.Contains(prompt, "AgentAction v1") {
		t.Error("prompt missing AgentAction v1 reference")
	}
	if payload.ProjectID != "prj-1" {
		t.Errorf("expected project_id prj-1, got %q", payload.ProjectID)
	}
}

func TestBuildRecoveryPromptIncludesSchemaContext(t *testing.T) {
	intervention := Intervention{
		ProjectID:  "prj-1",
		ResourceID: "res-1",
		Type:       TypePreflightError,
		Reason:     "Missing inputs",
	}
	schema := json.RawMessage(`{"properties":{"boundary":{"type":"entity_assignment","default_model":"k_omega_sst","default_entities":["wall"]}}}`)

	prompt, payload := BuildRecoveryPrompt(RecoveryPromptInput{
		Intervention: intervention,
		FormSchema:   schema,
	})

	if !strings.Contains(string(payload.FormSchema), "k_omega_sst") {
		t.Error("schema not included in payload")
	}
	if !strings.Contains(prompt, "Simulation Context") {
		t.Error("missing simulation context section")
	}
}

func TestBuildRecoveryPromptWithUserFeedback(t *testing.T) {
	intervention := Intervention{
		ProjectID:  "prj-1",
		ResourceID: "res-1",
		Type:       TypeSolverFailure,
		Reason:     "Solver diverged",
	}

	prompt, _ := BuildRecoveryPrompt(RecoveryPromptInput{
		Intervention:        intervention,
		UserHistoryFeedback: "User said the solution was too aggressive",
	})

	if !strings.Contains(prompt, "User Feedback History") {
		t.Error("missing user feedback history")
	}
}

func TestExtractAndValidateActionFromJSONBlock(t *testing.T) {
	response := "Here is my analysis:\n```json\n{\"version\":\"v1\",\"kind\":\"create-plan\",\"message\":\"Test plan\",\"proposals\":[{\"id\":\"p1\",\"action\":\"VolumeMesh\",\"target\":\"case\",\"name\":\"test\",\"intent\":\"test\",\"patch\":{},\"fields\":[{\"key\":\"a\",\"value\":1,\"provenance\":\"provided\"}]}]}\n```"
	action, err := ExtractAndValidateAction(response)
	if err != nil {
		t.Fatal(err)
	}
	if action.Kind != ActionCreatePlan {
		t.Fatalf("expected create-plan, got %q", action.Kind)
	}
}

func TestExtractAndValidateActionFindsBareJSON(t *testing.T) {
	response := `{"version":"v1","kind":"request-missing-input","message":"Need info","questions":[{"field":"vel","message":"velocity?","urgency":"required"}]}`
	action, err := ExtractAndValidateAction(response)
	if err != nil {
		t.Fatal(err)
	}
	if action.Kind != ActionRequestMissingInput {
		t.Fatalf("expected request-missing-input, got %q", action.Kind)
	}
}

func TestExtractAndValidateActionFindsFirstBrace(t *testing.T) {
	response := "thinking... ok here: {\"version\":\"v1\",\"kind\":\"create-plan\",\"message\":\"Plan\",\"proposals\":[{\"id\":\"p1\",\"action\":\"Case\",\"target\":\"case\",\"name\":\"x\",\"intent\":\"y\",\"patch\":{},\"fields\":[{\"key\":\"k\",\"value\":\"v\",\"provenance\":\"derived\"}]}]}"
	action, err := ExtractAndValidateAction(response)
	if err != nil {
		t.Fatal(err)
	}
	if len(action.Proposals) != 1 {
		t.Fatalf("expected 1 proposal, got %d", len(action.Proposals))
	}
}

func TestExtractAndValidateActionRejectsInvalidJSON(t *testing.T) {
	response := "No JSON here at all"
	_, err := ExtractAndValidateAction(response)
	if err == nil {
		t.Error("expected error for non-JSON response")
	}
}

func TestTruncateShortString(t *testing.T) {
	result := truncate("hello", 10)
	if result != "hello" {
		t.Errorf("expected hello, got %q", result)
	}
}

func TestTruncateLongString(t *testing.T) {
	long := strings.Repeat("a", 1000)
	result := truncate(long, 100)
	if len(result) > 100 {
		t.Errorf("expected truncated result <= 100 bytes, got length %d", len(result))
	}
	if !strings.HasSuffix(result, "...(truncated)") {
		t.Error("missing truncation marker")
	}
}

func TestTruncatePreservesUTF8AtByteBoundary(t *testing.T) {
	result := truncate(strings.Repeat("汉", 20), 20)
	if !utf8.ValidString(result) {
		t.Fatalf("truncate returned invalid UTF-8: %q", result)
	}
	if len(result) > 20 {
		t.Fatalf("expected at most 20 bytes, got %d", len(result))
	}
	if !strings.HasSuffix(result, "...(truncated)") {
		t.Fatalf("missing truncation marker: %q", result)
	}
}

func TestTruncateRepairsInvalidUTF8(t *testing.T) {
	result := truncate("有效"+string([]byte{0xff})+"内容", 100)
	if !utf8.ValidString(result) {
		t.Fatalf("truncate returned invalid UTF-8: %q", result)
	}
	if !strings.Contains(result, "�") {
		t.Fatalf("expected invalid byte replacement, got %q", result)
	}
}

func TestCodexPromptRepairsInvalidUTF8AtProviderBoundary(t *testing.T) {
	result := codexPrompt("system"+string([]byte{0xff}), "用户"+string([]byte{0xfe}))
	if !utf8.ValidString(result) {
		t.Fatalf("Codex stdin prompt is not valid UTF-8: %q", result)
	}
}

func TestParseContextPayloadRoundTrip(t *testing.T) {
	original := ChatContextPayload{
		ProjectID:  "prj-1",
		SourceID:   "case-1",
		SourceType: "Case",
		Target:     "case",
		Boundaries: []string{"wall", "farfield"},
		RecentLogs: "solver converged",
	}
	data, _ := json.Marshal(original)
	parsed := parseContextPayload(string(data))
	if parsed.ProjectID != original.ProjectID {
		t.Errorf("expected %q, got %q", original.ProjectID, parsed.ProjectID)
	}
	if len(parsed.Boundaries) != 2 {
		t.Errorf("expected 2 boundaries, got %d", len(parsed.Boundaries))
	}
}

func TestParseContextPayloadKeyValueFallback(t *testing.T) {
	payload := parseContextPayload("project:prj-1 resource:res-2")
	if payload.ProjectID != "prj-1" {
		t.Errorf("expected prj-1, got %q", payload.ProjectID)
	}
	if payload.SourceID != "res-2" {
		t.Errorf("expected res-2, got %q", payload.SourceID)
	}
}
