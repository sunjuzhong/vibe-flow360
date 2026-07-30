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
	Message  string    `json:"message"`
	Session  string    `json:"session,omitempty"`
	Model    string    `json:"model,omitempty"`
	Geometry string    `json:"geometry,omitempty"`
	Context  string    `json:"context,omitempty"`
	History  []Message `json:"history,omitempty"`
}

type State struct {
	Mode      string `json:"mode"`
	Model     string `json:"model"`
	Ready     bool   `json:"ready"`
	Execution bool   `json:"execution"`
}

type Service struct {
	APIKey  string
	BaseURL string
	Model   string
	Client  *http.Client
}

func NewService() *Service {
	key := firstNonEmpty(os.Getenv("VIBESIM_AI_API_KEY"), os.Getenv("OPENAI_API_KEY"))
	baseURL := strings.TrimRight(firstNonEmpty(os.Getenv("VIBESIM_AI_BASE_URL"), "https://api.openai.com/v1"), "/")
	model := firstNonEmpty(os.Getenv("VIBESIM_AI_MODEL"), "gpt-4.1-mini")
	return &Service{
		APIKey:  key,
		BaseURL: baseURL,
		Model:   model,
		Client:  &http.Client{Timeout: 90 * time.Second},
	}
}

func (s *Service) State() State {
	if strings.TrimSpace(s.APIKey) == "" {
		return State{Mode: "local-planner", Model: "CFD planning preset", Ready: true, Execution: false}
	}
	return State{Mode: "ai", Model: s.Model, Ready: true, Execution: false}
}

func (s *Service) Chat(ctx context.Context, request ChatRequest) (string, error) {
	if strings.TrimSpace(request.Message) == "" {
		return "", errors.New("message is required")
	}
	if strings.TrimSpace(s.APIKey) == "" {
		return localPlan(request), nil
	}

	model := firstNonEmpty(request.Model, s.Model)
	systemPrompt := AgentSystemPrompt()
	chatPrompt, _ := BuildChatPrompt(request)

	messages := []Message{{Role: "system", Content: systemPrompt}}
	for _, item := range request.History {
		if (item.Role == "user" || item.Role == "assistant") && strings.TrimSpace(item.Content) != "" {
			messages = append(messages, item)
		}
	}
	messages = append(messages, Message{Role: "user", Content: chatPrompt})

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
- proposals: array (for create-plan)
- questions: array (for request-missing-input)
- warnings: array of strings
- assumptions: array of strings

Your previous response was:
%s`, truncate(rawResponse, 2000))

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
	return fmt.Sprintf("> AI 模型当前不可用（%s），已切换到本地 CFD 规划模式。\n\n%s",
		err.Error(), localPlan(request))
}

func localPlan(request ChatRequest) string {
	message := strings.ToLower(request.Message)
	geometry := request.Geometry
	if geometry == "" {
		geometry = "尚未选择"
	}

	kind := "外流场空气动力学"
	if strings.Contains(message, "heat") || strings.Contains(message, "温度") || strings.Contains(message, "散热") {
		kind = "热流体分析"
	} else if strings.Contains(message, "propeller") || strings.Contains(message, "rotor") || strings.Contains(message, "螺旋桨") || strings.Contains(message, "旋翼") {
		kind = "旋转机械外流场"
	} else if strings.Contains(message, "pipe") || strings.Contains(message, "duct") || strings.Contains(message, "管道") || strings.Contains(message, "风道") {
		kind = "内流场分析"
	}

	context := strings.TrimSpace(request.Context)
	if context == "" {
		context = "当前没有选中的 Flow360 Project/resource"
	}

	return fmt.Sprintf(`我先把你的目标整理成一份可审查的仿真草案。

**当前理解**

- 分析类型：%s
- 几何文件：%s
- 工程目标：%s
- 当前页面上下文：%s

**开始前还需要确认**

1. 几何单位和一个可核对的参考尺寸
2. 来流速度或 Mach 数，以及温度、压力/高度
3. 稳态还是瞬态；如果不确定，第一轮建议用稳态 RANS
4. 你关注的结果：阻力、升力、压降、流量、温度还是局部流动

**建议的第一轮**

- 使用中等网格做趋势判断
- 保存力/力矩、残差与关键监控量
- 先运行一个基准工况，再生成参数 sweep
- 提交前展示完整 Flow360 参数差异和预期执行阶段

这只是本地规划，尚未创建或提交任何 Flow360 任务。补充上述条件后，我可以继续收敛成可执行计划。`,
		kind, geometry, request.Message, context)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
