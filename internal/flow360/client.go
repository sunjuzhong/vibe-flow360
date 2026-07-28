package flow360

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Client struct {
	Binary      string
	Timeout     time.Duration
	Profile     string
	Environment string
	APIKey      string
}

type Status struct {
	Available      bool   `json:"available"`
	Binary         string `json:"binary,omitempty"`
	Version        string `json:"version,omitempty"`
	Profile        string `json:"profile,omitempty"`
	Environment    string `json:"environment,omitempty"`
	Authentication string `json:"authentication,omitempty"`
	Error          string `json:"error,omitempty"`
}

type ResourceDetail struct {
	ID               string            `json:"id"`
	Type             string            `json:"type"`
	Info             json.RawMessage   `json:"info,omitempty"`
	State            json.RawMessage   `json:"state,omitempty"`
	Summary          json.RawMessage   `json:"summary,omitempty"`
	SimulationParams json.RawMessage   `json:"simulation_params,omitempty"`
	Results          json.RawMessage   `json:"results,omitempty"`
	Errors           map[string]string `json:"errors,omitempty"`
	mu               sync.Mutex
}

func NewClient() *Client {
	return &Client{
		Binary:      "flow360",
		Timeout:     20 * time.Second,
		Profile:     firstNonEmpty(os.Getenv("VIBESIM_FLOW360_PROFILE"), "default"),
		Environment: strings.TrimSpace(os.Getenv("VIBESIM_FLOW360_ENV")),
		APIKey:      firstNonEmpty(os.Getenv("VIBESIM_FLOW360_API_KEY"), os.Getenv("FLOW360_APIKEY")),
	}
}

func (c *Client) Status(ctx context.Context) Status {
	path, err := exec.LookPath(c.Binary)
	if err != nil {
		return c.status(false, "", "", "flow360 CLI was not found")
	}

	output, err := c.run(ctx, "version")
	if err != nil {
		return c.status(false, path, "", err.Error())
	}

	return c.status(true, path, firstMeaningfulLine(output), "")
}

func (c *Client) Projects(ctx context.Context, limit int, folderID string) (json.RawMessage, error) {
	if limit < 1 || limit > 100 {
		limit = 25
	}
	args := []string{"project", "list", "--limit", fmt.Sprint(limit), "--format", "json"}
	if strings.TrimSpace(folderID) != "" {
		args = append(args, "--folder-id", strings.TrimSpace(folderID), "--exclude-subfolders")
	}
	output, err := c.run(ctx, args...)
	if err != nil {
		return nil, err
	}
	raw, err := extractJSON(output)
	if err != nil {
		return nil, errors.New("flow360 returned invalid project JSON")
	}
	return raw, nil
}

func (c *Client) Folders(ctx context.Context) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "folder", "tree")
}

func (c *Client) ProjectInfo(ctx context.Context, projectID string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "project", "info", projectID)
}

func (c *Client) ProjectTree(ctx context.Context, projectID string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "project", "tree", projectID)
}

func (c *Client) ProjectItems(ctx context.Context, projectID string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "project", "items", projectID)
}

func (c *Client) ResourceDetail(ctx context.Context, resourceType, resourceID string) (ResourceDetail, error) {
	command, normalizedType, err := resourceCommand(resourceType)
	if err != nil {
		return ResourceDetail{}, err
	}
	detail := ResourceDetail{
		ID:     resourceID,
		Type:   normalizedType,
		Errors: map[string]string{},
	}

	type operation struct {
		name string
		args []string
		set  func(json.RawMessage)
	}
	operations := []operation{
		{name: "info", args: []string{command, "info", resourceID}, set: func(raw json.RawMessage) { detail.Info = raw }},
		{name: "state", args: []string{command, "state", resourceID}, set: func(raw json.RawMessage) { detail.State = raw }},
		{name: "summary", args: []string{command, "summary", resourceID}, set: func(raw json.RawMessage) { detail.Summary = raw }},
		{
			name: "simulation_params",
			args: []string{command, "simulation-params", "get", resourceID},
			set:  func(raw json.RawMessage) { detail.SimulationParams = raw },
		},
	}
	if command == "case" {
		operations = append(operations, operation{
			name: "results",
			args: []string{"case", "results", "list", resourceID},
			set:  func(raw json.RawMessage) { detail.Results = raw },
		})
	}

	var wait sync.WaitGroup
	for _, item := range operations {
		item := item
		wait.Add(1)
		go func() {
			defer wait.Done()
			raw, commandErr := c.jsonCommand(ctx, item.args...)
			detail.mu.Lock()
			defer detail.mu.Unlock()
			if commandErr != nil {
				detail.Errors[item.name] = item.name + " is unavailable"
				return
			}
			item.set(raw)
		}()
	}
	wait.Wait()
	detail.mu = sync.Mutex{}
	return detail, nil
}

func (c *Client) ResourceLogs(ctx context.Context, resourceType, resourceID string, tail int) ([]byte, error) {
	if _, _, err := resourceCommand(resourceType); err != nil {
		return nil, err
	}
	if tail < 1 || tail > 5000 {
		tail = 200
	}
	return c.run(ctx, "logs", resourceID, "--tail", fmt.Sprint(tail))
}

func (c *Client) ResourceResult(ctx context.Context, resourceType, resourceID, resultPath string) ([]byte, string, error) {
	command, _, err := resourceCommand(resourceType)
	if err != nil {
		return nil, "", err
	}
	if command != "case" {
		return nil, "", fmt.Errorf("result artifacts are only available for Case resources")
	}
	output, err := c.downloadCaseResult(ctx, resourceID, resultPath)
	if err != nil {
		return nil, "", err
	}
	ext := strings.ToLower(filepath.Ext(resultPath))
	switch ext {
	case ".csv", ".txt", ".dat":
		return output, "text/plain; charset=utf-8", nil
	default:
		return output, "application/octet-stream", nil
	}
}

func (c *Client) ResourceResultPreview(ctx context.Context, resourceType, resourceID, resultPath string) ([]byte, error) {
	command, _, err := resourceCommand(resourceType)
	if err != nil {
		return nil, err
	}
	if command != "case" {
		return nil, fmt.Errorf("result artifacts are only available for Case resources")
	}
	ext := strings.ToLower(filepath.Ext(resultPath))
	if ext != ".csv" && ext != ".txt" && ext != ".dat" {
		return nil, fmt.Errorf("preview is only available for text files (.csv, .txt, .dat)")
	}
	return c.downloadCaseResult(ctx, resourceID, resultPath)
}

func (c *Client) downloadCaseResult(ctx context.Context, resourceID, resultPath string) ([]byte, error) {
	tempDir, err := os.MkdirTemp("", "vibesim-result-*")
	if err != nil {
		return nil, fmt.Errorf("create result workspace: %w", err)
	}
	defer os.RemoveAll(tempDir)

	outputPath := filepath.Join(tempDir, firstNonEmpty(filepath.Base(resultPath), "result"))
	if _, err := c.runWithTimeout(
		ctx,
		5*time.Minute,
		"case", "results", "get", resourceID, resultPath,
		"--output", outputPath,
		"--overwrite",
	); err != nil {
		return nil, err
	}
	output, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("read downloaded result: %w", err)
	}
	return output, nil
}

func (c *Client) RunDraft(ctx context.Context, sourceID, name, target string, patch json.RawMessage) (json.RawMessage, error) {
	temp, err := os.CreateTemp("", "vibesim-plan-*.json")
	if err != nil {
		return nil, fmt.Errorf("create temporary patch: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return nil, err
	}
	if _, err := temp.Write(patch); err != nil {
		temp.Close()
		return nil, err
	}
	if err := temp.Close(); err != nil {
		return nil, err
	}

	output, err := c.runWithTimeout(
		ctx,
		2*time.Minute,
		"draft", "run", sourceID,
		"--name", name,
		"--patch", tempPath,
		"--up-to", target,
	)
	if err != nil {
		return nil, err
	}
	raw, err := extractJSON(output)
	if err == nil {
		return raw, nil
	}
	fallback, marshalErr := json.Marshal(map[string]string{"output": compactOutput(output)})
	if marshalErr != nil {
		return nil, marshalErr
	}
	return fallback, nil
}

func (c *Client) CreateProject(ctx context.Context, files []string, sourceType, name, unit, workflow, solverVersion, folderID string, tags []string) (json.RawMessage, error) {
	args := []string{"project", "create"}
	args = append(args, files...)
	args = append(args, "--from", sourceType, "--name", name, "--unit", unit)
	if sourceType == "geometry" && workflow != "" {
		args = append(args, "--workflow", workflow)
	}
	if solverVersion != "" {
		args = append(args, "--solver-version", solverVersion)
	}
	if folderID != "" {
		args = append(args, "--folder-id", folderID)
	}
	for _, tag := range tags {
		args = append(args, "--tag", tag)
	}
	output, err := c.runWithTimeout(ctx, 5*time.Minute, args...)
	if err != nil {
		return nil, err
	}
	raw, err := extractJSON(output)
	if err == nil {
		return raw, nil
	}
	return json.Marshal(map[string]string{"output": compactOutput(output)})
}

func resourceCommand(resourceType string) (command, normalizedType string, err error) {
	switch strings.ToLower(strings.TrimSpace(resourceType)) {
	case "geometry":
		return "geometry", "Geometry", nil
	case "surfacemesh", "surface-mesh", "surface_mesh":
		return "surface-mesh", "SurfaceMesh", nil
	case "volumemesh", "volume-mesh", "volume_mesh":
		return "volume-mesh", "VolumeMesh", nil
	case "case":
		return "case", "Case", nil
	default:
		return "", "", fmt.Errorf("unsupported resource type %q", resourceType)
	}
}

func (c *Client) jsonCommand(ctx context.Context, args ...string) (json.RawMessage, error) {
	output, err := c.run(ctx, args...)
	if err != nil {
		return nil, err
	}
	raw, err := extractJSON(output)
	if err != nil {
		return nil, fmt.Errorf("flow360 returned invalid JSON: %w", err)
	}
	return raw, nil
}

func extractJSON(output []byte) (json.RawMessage, error) {
	for start := 0; start < len(output); {
		line := bytes.TrimLeft(output[start:], " \t\r")
		if len(line) > 0 && (line[0] == '{' || line[0] == '[') {
			decoder := json.NewDecoder(bytes.NewReader(line))
			var raw json.RawMessage
			if err := decoder.Decode(&raw); err == nil && json.Valid(raw) {
				return raw, nil
			}
		}
		next := bytes.IndexByte(output[start:], '\n')
		if next < 0 {
			break
		}
		start += next + 1
	}
	return nil, errors.New("no valid JSON value found")
}

func compactOutput(data []byte) string {
	value := strings.Join(strings.Fields(string(data)), " ")
	if len(value) > 2000 {
		return value[:2000] + "…"
	}
	return value
}

func (c *Client) run(parent context.Context, args ...string) ([]byte, error) {
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return c.runWithTimeout(parent, timeout, args...)
}

func (c *Client) runWithTimeout(parent context.Context, timeout time.Duration, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	commandArgs := c.commandArgs(args...)
	cmd := exec.CommandContext(ctx, c.Binary, commandArgs...)
	if c.APIKey != "" {
		cmd.Env = append(os.Environ(), "FLOW360_APIKEY="+c.APIKey)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("flow360 command timed out")
	}
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("flow360: %s", message)
	}
	return output, nil
}

func (c *Client) commandArgs(args ...string) []string {
	result := make([]string, 0, len(args)+4)
	if c.Profile != "" {
		result = append(result, "--profile", c.Profile)
	}
	switch strings.ToLower(strings.TrimSpace(c.Environment)) {
	case "", "default", "prod", "production":
	case "dev":
		result = append(result, "--dev")
	case "uat":
		result = append(result, "--uat")
	default:
		result = append(result, "--env", c.Environment)
	}
	return append(result, args...)
}

func (c *Client) status(available bool, binary, version, errorMessage string) Status {
	environment := strings.TrimSpace(c.Environment)
	if environment == "" {
		environment = "production"
	}
	authentication := "stored-profile"
	if c.APIKey != "" {
		authentication = "environment"
	}
	return Status{
		Available:      available,
		Binary:         binary,
		Version:        version,
		Profile:        firstNonEmpty(c.Profile, "default"),
		Environment:    environment,
		Authentication: authentication,
		Error:          errorMessage,
	}
}

func firstMeaningfulLine(output []byte) string {
	for _, line := range strings.Split(string(output), "\n") {
		value := strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(value), "installed version:") {
			return value
		}
	}
	for _, line := range strings.Split(string(output), "\n") {
		if value := strings.TrimSpace(line); value != "" {
			return value
		}
	}
	return "installed"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
