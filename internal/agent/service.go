package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Message    string    `json:"message"`
	Session    string    `json:"session,omitempty"`
	ProjectID  string    `json:"project_id,omitempty"`
	ResourceID string    `json:"resource_id,omitempty"`
	ScopeType  string    `json:"scope_type,omitempty"`
	ScopeID    string    `json:"scope_id,omitempty"`
	Model      string    `json:"model,omitempty"`
	Geometry   string    `json:"geometry,omitempty"`
	Context    string    `json:"context,omitempty"`
	History    []Message `json:"history,omitempty"`
}

type State struct {
	Mode      string `json:"mode"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Ready     bool   `json:"ready"`
	Execution bool   `json:"execution"`
}

type Service struct {
	Provider     string
	APIKey       string
	BaseURL      string
	Model        string
	Client       *http.Client
	CodexBinary  string
	CodexModel   string
	CodexProfile string
	CodexTimeout time.Duration
	WorkDir      string
}

func NewService() *Service {
	provider := strings.ToLower(firstNonEmpty(os.Getenv("VIBESIM_AGENT_PROVIDER"), "builtin"))
	key := firstNonEmpty(os.Getenv("VIBESIM_AI_API_KEY"), os.Getenv("OPENAI_API_KEY"))
	baseURL := strings.TrimRight(firstNonEmpty(os.Getenv("VIBESIM_AI_BASE_URL"), "https://api.openai.com/v1"), "/")
	model := firstNonEmpty(os.Getenv("VIBESIM_AI_MODEL"), "gpt-4.1-mini")
	workDir, _ := os.Getwd()
	return &Service{
		Provider:     provider,
		APIKey:       key,
		BaseURL:      baseURL,
		Model:        model,
		Client:       &http.Client{Timeout: 90 * time.Second},
		CodexBinary:  firstNonEmpty(os.Getenv("VIBESIM_CODEX_BINARY"), "codex"),
		CodexModel:   strings.TrimSpace(os.Getenv("VIBESIM_CODEX_MODEL")),
		CodexProfile: strings.TrimSpace(os.Getenv("VIBESIM_CODEX_PROFILE")),
		CodexTimeout: codexTimeoutFromEnv(),
		WorkDir:      workDir,
	}
}

func (s *Service) effectiveProvider() string {
	return firstNonEmpty(strings.ToLower(strings.TrimSpace(s.Provider)), "builtin")
}

func (s *Service) SupportsGeneration() bool {
	switch s.effectiveProvider() {
	case "codex":
		return s.codexReady()
	case "builtin":
		return strings.TrimSpace(s.APIKey) != ""
	default:
		return false
	}
}

func (s *Service) State() State {
	provider := s.effectiveProvider()
	if provider == "codex" {
		model := firstNonEmpty(s.CodexModel, "Codex CLI default")
		return State{Mode: "codex", Provider: "codex", Model: model, Ready: s.codexReady(), Execution: false}
	}
	if provider != "builtin" {
		return State{Mode: "configuration-error", Provider: provider, Model: "Unknown provider", Ready: false, Execution: false}
	}
	if strings.TrimSpace(s.APIKey) == "" {
		return State{Mode: "local-planner", Provider: "builtin", Model: "CFD planning preset", Ready: true, Execution: false}
	}
	return State{Mode: "ai", Provider: "builtin", Model: s.Model, Ready: true, Execution: false}
}

func (s *Service) Chat(ctx context.Context, request ChatRequest) (string, error) {
	if strings.TrimSpace(request.Message) == "" {
		return "", errors.New("message is required")
	}
	provider := s.effectiveProvider()
	if provider == "codex" {
		systemPrompt := AgentSystemPrompt()
		chatPrompt, _ := BuildChatPrompt(request)
		return s.chatWithCodex(ctx, systemPrompt, chatPrompt, request.Model)
	}
	if provider != "builtin" {
		return "", fmt.Errorf("unsupported agent provider %q; use builtin or codex", provider)
	}
	if strings.TrimSpace(s.APIKey) == "" {
		return localPlan(request), nil
	}

	model := firstNonEmpty(request.Model, s.Model)
	systemPrompt := AgentSystemPrompt()
	chatPrompt, _ := BuildChatPrompt(request)

	// BuildChatPrompt already carries the bounded conversation history. Keeping
	// one canonical prompt path avoids sending the same history twice to the
	// built-in provider while Codex receives a different conversation.
	messages := []Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: chatPrompt},
	}

	payload := struct {
		Model       string    `json:"model"`
		Messages    []Message `json:"messages"`
		Temperature float64   `json:"temperature"`
	}{
		Model: model, Messages: messages, Temperature: 0.2,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	req.Header.Set("Content-Type", "application/json")

	response, err := s.Client.Do(req)
	if err != nil {
		return providerFallback(request, err), nil
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return "", err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return providerFallback(request, fmt.Errorf("AI provider returned %s", response.Status)), nil
	}

	var result struct {
		Choices []struct {
			Message Message `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", fmt.Errorf("decode AI response: %w", err)
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return "", errors.New("AI provider returned an empty response")
	}
	return result.Choices[0].Message.Content, nil
}

// Complete runs a purpose-specific prompt through the configured model without
// applying the conversational AgentAction contract. Callers are responsible
// for validating the returned structured output before using it.
func (s *Service) Complete(ctx context.Context, systemPrompt, userPrompt, requestedModel string) (string, error) {
	if strings.TrimSpace(systemPrompt) == "" || strings.TrimSpace(userPrompt) == "" {
		return "", errors.New("system and user prompts are required")
	}
	provider := s.effectiveProvider()
	if provider == "codex" {
		return s.chatWithCodex(ctx, systemPrompt, userPrompt, requestedModel)
	}
	if provider != "builtin" {
		return "", fmt.Errorf("unsupported agent provider %q; use builtin or codex", provider)
	}
	if strings.TrimSpace(s.APIKey) == "" {
		return "", errors.New("AI Create requires a configured model provider")
	}

	payload := struct {
		Model       string    `json:"model"`
		Messages    []Message `json:"messages"`
		Temperature float64   `json:"temperature"`
	}{
		Model: firstNonEmpty(requestedModel, s.Model),
		Messages: []Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Temperature: 0.1,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := s.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("AI provider request failed: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return "", err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("AI provider returned %s", response.Status)
	}
	var result struct {
		Choices []struct {
			Message Message `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", fmt.Errorf("decode AI response: %w", err)
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return "", errors.New("AI provider returned an empty response")
	}
	return result.Choices[0].Message.Content, nil
}

func (s *Service) ChatWithValidation(ctx context.Context, request ChatRequest) (string, *Action, error) {
	rawResponse, err := s.Chat(ctx, request)
	if err != nil {
		return rawResponse, nil, err
	}
	if strings.TrimSpace(rawResponse) == "" {
		return rawResponse, nil, errors.New("empty AI response")
	}

	action, err := ValidateAndRepair(ctx, rawResponse, s, request)
	if err != nil {
		return rawResponse, nil, err
	}
	return rawResponse, &action, nil
}

func ValidateAndRepair(ctx context.Context, rawResponse string, s *Service, request ChatRequest) (Action, error) {
	action, err := ExtractAndValidateAction(rawResponse)
	if err == nil {
		return action, nil
	}

	repairPrompt := fmt.Sprintf(`Your previous response could not be parsed as a valid AgentAction v1 JSON object.
Please respond with ONLY a valid JSON object in a fenced code block. The schema is:
- version: "v1"
- kind: "create-plan" or "request-missing-input"
- message: string (required)
- proposals: array (for create-plan). Every proposal must contain id, action, target, name,
  intent, patch (a JSON object), branch_preview, and fields.
- proposals[].fields: ARRAY of objects shaped exactly as
  {"key":"SimulationParams path","value":<JSON value>,"provenance":"provided|derived|inferred|defaulted","description":"optional"}.
  Never emit fields as an object/map; use [] when empty.
- questions: array (for request-missing-input), each with field, message, urgency, reason, type
  (text|number|select|boolean), and optional unit/options/default/min/max/placeholder/recommendation.
  Always include type. Include a safe evidence-based default and recommendation whenever possible.
- warnings: array of strings
- assumptions: array of strings

Use the same language as the original user request for all human-readable string values. Keep JSON keys, enum values, and SimulationParams paths unchanged.

The original user request was:
%s

Your previous response was:
%s`, truncate(request.Message, 1000), truncate(rawResponse, 2000))

	if s.effectiveProvider() == "codex" {
		repaired, repairErr := s.chatWithCodex(ctx, AgentSystemPrompt(), repairPrompt, request.Model)
		if repairErr != nil {
			return Action{}, fmt.Errorf("Codex repair failed: %w (original parse: %v)", repairErr, err)
		}
		action, repairErr := ExtractAndValidateAction(repaired)
		if repairErr != nil {
			return Action{}, fmt.Errorf("Codex repair also failed: %v (original: %v)", repairErr, err)
		}
		return action, nil
	}

	model := firstNonEmpty(request.Model, s.Model)
	systemPrompt := AgentSystemPrompt()
	repairMessages := []Message{{Role: "system", Content: systemPrompt}}
	repairMessages = append(repairMessages, Message{Role: "user", Content: repairPrompt})

	payload := struct {
		Model       string    `json:"model"`
		Messages    []Message `json:"messages"`
		Temperature float64   `json:"temperature"`
	}{
		Model: model, Messages: repairMessages, Temperature: 0.1,
	}
	body, marshalErr := json.Marshal(payload)
	if marshalErr != nil {
		return Action{}, fmt.Errorf("repair marshal: %w (original parse: %v)", marshalErr, err)
	}

	req, httpErr := http.NewRequestWithContext(ctx, http.MethodPost, s.BaseURL+"/chat/completions", bytes.NewReader(body))
	if httpErr != nil {
		return Action{}, fmt.Errorf("repair request: %w (original parse: %v)", httpErr, err)
	}
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	req.Header.Set("Content-Type", "application/json")

	response, doErr := s.Client.Do(req)
	if doErr != nil {
		return Action{}, fmt.Errorf("repair call failed: %w (original parse: %v)", doErr, err)
	}
	defer response.Body.Close()
	data, readErr := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if readErr != nil {
		return Action{}, fmt.Errorf("repair read: %w (original parse: %v)", readErr, err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Action{}, fmt.Errorf("repair returned %d: original parse: %v", response.StatusCode, err)
	}

	var result struct {
		Choices []struct {
			Message Message `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(data, &result) != nil || len(result.Choices) == 0 {
		return Action{}, fmt.Errorf("repair decode failed: original parse: %v", err)
	}

	repaired := strings.TrimSpace(result.Choices[0].Message.Content)
	action, repairErr := ExtractAndValidateAction(repaired)
	if repairErr != nil {
		return Action{}, fmt.Errorf("repair also failed: %v (original: %v)", repairErr, err)
	}
	return action, nil
}

func providerFallback(request ChatRequest, err error) string {
	if containsHan(request.Message) {
		return fmt.Sprintf("> AI 模型当前不可用（%s），已切换到本地 CFD 规划模式。\n\n%s",
			err.Error(), localPlan(request))
	}
	return fmt.Sprintf("> The AI model is currently unavailable (%s), so I switched to local CFD planning mode.\n\n%s",
		err.Error(), localPlan(request))
}

func localPlan(request ChatRequest) string {
	message := strings.ToLower(request.Message)
	geometry := request.Geometry
	if geometry == "" {
		geometry = "not specified"
	}

	kind := "external aerodynamics"
	if strings.Contains(message, "heat") || strings.Contains(message, "温度") || strings.Contains(message, "散热") {
		kind = "thermal-fluid analysis"
	} else if strings.Contains(message, "propeller") || strings.Contains(message, "rotor") || strings.Contains(message, "螺旋桨") || strings.Contains(message, "旋翼") {
		kind = "rotating-machinery aerodynamics"
	} else if strings.Contains(message, "pipe") || strings.Contains(message, "duct") || strings.Contains(message, "管道") || strings.Contains(message, "风道") {
		kind = "internal-flow analysis"
	}

	_, parsed := BuildChatPrompt(request)
	context := "no Flow360 Project/resource is selected"
	if parsed.ProjectID != "" {
		context = fmt.Sprintf("Project %s (%s)", firstNonEmpty(parsed.ProjectName, "unnamed"), parsed.ProjectID)
		if parsed.SourceID != "" {
			context += fmt.Sprintf(", selected %s %s (%s), status %s",
				firstNonEmpty(parsed.SourceType, "resource"), firstNonEmpty(parsed.SourceName, "unnamed"),
				parsed.SourceID, firstNonEmpty(parsed.SourceStatus, "unknown"))
		}
	}
	if containsHan(request.Message) {
		return fmt.Sprintf(`以下是根据当前本地上下文整理的第一版 CFD 分析草案。

**当前理解**

- 分析类型：%s
- 几何：%s
- 工程问题：%s
- 当前上下文：%s

**执行前需要确认**

1. 几何单位和一个可核对的参考尺寸
2. 入口速度或 Mach 数，以及温度和压力/高度
3. 稳态或非稳态；不确定时可先用稳态 RANS 建立基线
4. 主要输出，例如力、力矩、压降、流量、温度或局部流动结构

这只是本地建议；尚未创建或提交任何 Flow360 任务。`,
			localizedAnalysisKind(kind), localizedGeometry(geometry), request.Message, localizedContext(parsed))
	}

	return fmt.Sprintf(`Here is a reviewable first-pass CFD brief based on the available local context.

**Current understanding**

- Analysis type: %s
- Geometry: %s
- Engineering question: %s
- Current context: %s

**Inputs to confirm before execution**

1. Geometry units and one verifiable reference dimension
2. Inlet speed or Mach number, plus temperature and pressure/altitude
3. Steady or unsteady modeling; steady RANS is a reasonable first baseline when uncertain
4. Primary outputs such as force, moment, pressure drop, flow rate, temperature, or local flow structures

**Suggested first pass**

- Use a medium-resolution mesh to establish trends
- Save forces/moments, residuals, and relevant monitor histories
- Establish one baseline before generating a parameter sweep
- Review the complete Flow360 parameter diff and target stage before submission

This is local guidance only; no Flow360 task has been created or submitted.`,
		kind, geometry, request.Message, context)
}

func containsHan(value string) bool {
	for _, r := range value {
		if r >= '\u4e00' && r <= '\u9fff' {
			return true
		}
	}
	return false
}

func localizedAnalysisKind(kind string) string {
	switch kind {
	case "thermal-fluid analysis":
		return "热流体分析"
	case "rotating-machinery aerodynamics":
		return "旋转机械空气动力学"
	case "internal-flow analysis":
		return "内流分析"
	default:
		return "外流空气动力学"
	}
}

func localizedGeometry(geometry string) string {
	if geometry == "not specified" {
		return "未指定"
	}
	return geometry
}

func localizedContext(parsed ChatContextPayload) string {
	if parsed.ProjectID == "" {
		return "未选择 Flow360 Project/resource"
	}
	context := fmt.Sprintf("Project %s（%s）", firstNonEmpty(parsed.ProjectName, "未命名"), parsed.ProjectID)
	if parsed.SourceID != "" {
		context += fmt.Sprintf("，当前 %s %s（%s），状态 %s",
			firstNonEmpty(parsed.SourceType, "resource"), firstNonEmpty(parsed.SourceName, "未命名"),
			parsed.SourceID, firstNonEmpty(parsed.SourceStatus, "未知"))
	}
	return context
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
