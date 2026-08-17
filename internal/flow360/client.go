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
	"sync/atomic"
	"time"
)

type Client struct {
	Binary            string
	Timeout           time.Duration
	ResourceTimeout   time.Duration
	ResourceRetries   int
	Profile           string
	Environment       string
	APIKey            string
	ManagedRuntimeDir string
	// UpgradeCompatible is invoked when the cloud SimulationParams patch
	// version is newer than the installed runtime but remains in the release
	// line supported by this Vibe Flow360 build. Tests and custom embedders may
	// replace it; NewClient configures the isolated managed-runtime upgrader.
	UpgradeCompatible func(context.Context, string, string) error

	upgradeMu       sync.Mutex
	upgradedThrough string
	activeBinary    atomic.Pointer[string]
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
}

func NewClient() *Client {
	client := &Client{
		Binary:            resolveFlow360Binary(),
		Timeout:           timeoutFromEnv("VIBESIM_FLOW360_TIMEOUT_SECONDS", defaultCommandTimeout),
		ResourceTimeout:   timeoutFromEnv("VIBESIM_FLOW360_RESOURCE_TIMEOUT_SECONDS", defaultResourceTimeout),
		ResourceRetries:   intFromEnv("VIBESIM_FLOW360_RESOURCE_RETRIES", defaultResourceRetries, 1, 10),
		Profile:           firstNonEmpty(os.Getenv("VIBESIM_FLOW360_PROFILE"), "default"),
		Environment:       strings.TrimSpace(os.Getenv("VIBESIM_FLOW360_ENV")),
		APIKey:            firstNonEmpty(os.Getenv("VIBESIM_FLOW360_API_KEY"), os.Getenv("FLOW360_APIKEY")),
		ManagedRuntimeDir: strings.TrimSpace(os.Getenv("VIBESIM_FLOW360_RUNTIME_DIR")),
	}
	client.UpgradeCompatible = client.upgradeManagedRuntime
	return client
}

func resolveFlow360Binary() string {
	if configured := strings.TrimSpace(os.Getenv("VIBESIM_FLOW360_BINARY")); configured != "" {
		return configured
	}
	if python := strings.TrimSpace(os.Getenv("VIBESIM_FLOW360_PYTHON")); python != "" {
		if candidate := executableFile(filepath.Join(filepath.Dir(python), "flow360")); candidate != "" {
			return candidate
		}
	}
	if candidate := managedFlow360Binary(); candidate != "" {
		return candidate
	}

	path, err := exec.LookPath("flow360")
	if err == nil && !isPyenvShim(path) {
		return path
	}
	if candidate := pyenvFlow360Binary(); candidate != "" {
		return candidate
	}
	if err == nil {
		return path
	}
	return "flow360"
}

func managedFlow360Binary() string {
	runtimeDir := strings.TrimSpace(os.Getenv("VIBESIM_FLOW360_RUNTIME_DIR"))
	var err error
	if runtimeDir != "" {
		runtimeDir, err = filepath.Abs(runtimeDir)
	} else {
		runtimeDir, err = defaultManagedRuntimeDir()
	}
	if err != nil {
		return ""
	}
	return executableFile(filepath.Join(runtimeDir, "bin", "flow360"))
}

func defaultManagedRuntimeDir() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "vibe-flow360", "runtime"), nil
}

func (c *Client) managedRuntimeDir() (string, error) {
	if configured := strings.TrimSpace(c.ManagedRuntimeDir); configured != "" {
		return filepath.Abs(configured)
	}
	return defaultManagedRuntimeDir()
}

func (c *Client) runtimeBinary() string {
	if active := c.activeBinary.Load(); active != nil {
		return *active
	}
	return c.Binary
}

func (c *Client) activateRuntimeBinary(path string) {
	value := strings.Clone(path)
	c.activeBinary.Store(&value)
}

func pyenvFlow360Binary() string {
	root := strings.TrimSpace(os.Getenv("PYENV_ROOT"))
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		root = filepath.Join(home, ".pyenv")
	}
	if candidate := executableFile(filepath.Join(root, "versions", "flow360", "bin", "flow360")); candidate != "" {
		return candidate
	}
	matches, _ := filepath.Glob(filepath.Join(root, "versions", "*", "envs", "flow360", "bin", "flow360"))
	for _, candidate := range matches {
		if executable := executableFile(candidate); executable != "" {
			return executable
		}
	}
	return ""
}

func executableFile(path string) string {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || info.Mode().Perm()&0o111 == 0 {
		return ""
	}
	return path
}

func isPyenvShim(path string) bool {
	clean := filepath.Clean(path)
	if root := strings.TrimSpace(os.Getenv("PYENV_ROOT")); root != "" {
		if filepath.Dir(clean) == filepath.Join(filepath.Clean(root), "shims") {
			return true
		}
	}
	slashed := filepath.ToSlash(clean)
	return strings.Contains(slashed, "/.pyenv/shims/") || strings.Contains(slashed, "/pyenv/shims/")
}

func (c *Client) Status(ctx context.Context) Status {
	path, err := exec.LookPath(c.runtimeBinary())
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
	folderID = strings.TrimSpace(folderID)
	// ROOT.FLOW360 is the workspace itself, not a regular folder. Listing the
	// workspace without a folder filter is both the canonical Flow360 query and
	// allows callers to share the all-projects snapshot.
	if folderID != "" && !strings.EqualFold(folderID, "ROOT.FLOW360") {
		args = append(args, "--folder-id", folderID, "--exclude-subfolders")
	}
	output, err := c.run(ctx, args...)
	if err != nil {
		if unsupportedProjectTypeError(err) {
			return c.projectsWithoutStrictTypeValidation(ctx, limit, folderID)
		}
		return nil, err
	}
	raw, err := extractJSON(output)
	if err != nil {
		return nil, errors.New("flow360 returned invalid project JSON")
	}
	return raw, nil
}

// FindProjectByName reconciles a Project whose create command completed but
// returned an incomplete response. The creation-time boundary prevents an old
// same-name Project from being mistaken for the current request.
func (c *Client) FindProjectByName(ctx context.Context, folderID, name, sourceType string, notBefore time.Time) (json.RawMessage, error) {
	raw, err := c.Projects(ctx, 100, folderID)
	if err != nil {
		return nil, err
	}
	expectedName := strings.TrimSpace(name)
	expectedType := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(sourceType)), "-", "")
	var selected map[string]any
	var selectedAt time.Time
	for _, record := range collectRecordsFromKeys(raw, "records", "projects", "items") {
		projectName, _ := record["name"].(string)
		projectID, _ := record["id"].(string)
		if strings.TrimSpace(projectName) != expectedName || strings.TrimSpace(projectID) == "" {
			continue
		}
		rootType, _ := record["root_item_type"].(string)
		if rootType == "" {
			rootType, _ = record["rootItemType"].(string)
		}
		if expectedType != "" && strings.ReplaceAll(strings.ToLower(rootType), "-", "") != expectedType {
			continue
		}
		createdAt, parseErr := time.Parse(time.RFC3339Nano, strings.TrimSpace(stringField(record, "created_at", "createdAt")))
		if parseErr != nil || (!notBefore.IsZero() && createdAt.Before(notBefore)) {
			continue
		}
		if selected == nil || createdAt.After(selectedAt) {
			selected = record
			selectedAt = createdAt
		}
	}
	if selected == nil {
		return nil, errors.New("matching newly created Flow360 Project was not found")
	}
	return json.Marshal(selected)
}

func collectRecordsFromKeys(raw json.RawMessage, keys ...string) []map[string]any {
	var payload any
	if json.Unmarshal(raw, &payload) != nil {
		return nil
	}
	var visit func(any) []map[string]any
	visit = func(value any) []map[string]any {
		switch typed := value.(type) {
		case []any:
			records := make([]map[string]any, 0, len(typed))
			for _, item := range typed {
				if record, ok := item.(map[string]any); ok {
					records = append(records, record)
				}
			}
			return records
		case map[string]any:
			for _, key := range keys {
				if nested, ok := typed[key]; ok {
					return visit(nested)
				}
			}
		}
		return nil
	}
	return visit(payload)
}

func stringField(record map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := record[key].(string); ok {
			return value
		}
	}
	return ""
}

func (c *Client) Folders(ctx context.Context) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "folder", "tree")
}

func (c *Client) CreateFolder(ctx context.Context, name, parentFolderID string, tags []string) (json.RawMessage, error) {
	args := []string{"folder", "create", "--name", strings.TrimSpace(name), "--parent-folder-id", strings.TrimSpace(parentFolderID)}
	for _, tag := range tags {
		if value := strings.TrimSpace(tag); value != "" {
			args = append(args, "--tag", value)
		}
	}
	return c.jsonCommand(ctx, args...)
}

func (c *Client) RenameFolder(ctx context.Context, folderID, name string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "folder", "rename", strings.TrimSpace(folderID), "--name", strings.TrimSpace(name))
}

func (c *Client) MoveFolder(ctx context.Context, folderID, parentFolderID string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "folder", "move", strings.TrimSpace(folderID), "--parent-folder-id", strings.TrimSpace(parentFolderID))
}

func (c *Client) DeleteFolder(ctx context.Context, folderID string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "folder", "delete", strings.TrimSpace(folderID), "--yes")
}

func (c *Client) ProjectInfo(ctx context.Context, projectID string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "project", "info", projectID)
}

func (c *Client) RenameProject(ctx context.Context, projectID, name string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "project", "rename", strings.TrimSpace(projectID), "--name", strings.TrimSpace(name))
}

func (c *Client) DeleteProject(ctx context.Context, projectID string) (json.RawMessage, error) {
	projectID = strings.TrimSpace(projectID)
	raw, err := c.jsonCommand(ctx, "project", "delete", projectID, "--yes")
	if err != nil && isFlow360NotFoundError(err) {
		return json.Marshal(map[string]any{
			"id":             projectID,
			"deleted":        true,
			"already_absent": true,
		})
	}
	return raw, err
}

func isFlow360NotFoundError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "item not found") ||
		strings.Contains(message, "not found error") ||
		strings.Contains(message, "httpstatus': 'not_found") ||
		strings.Contains(message, `"httpstatus":"not_found"`) ||
		strings.Contains(message, "4040000001")
}

func (c *Client) ProjectTree(ctx context.Context, projectID string) (json.RawMessage, error) {
	return c.jsonCommandWithTimeout(ctx, c.resourceCommandTimeout(), "project", "tree", projectID)
}

func (c *Client) ProjectItems(ctx context.Context, projectID string) (json.RawMessage, error) {
	return c.jsonCommandWithTimeout(ctx, c.resourceCommandTimeout(), "project", "items", projectID)
}

// ProjectDrafts lists the editable Flow360 Draft configurations associated
// with a Project. Drafts are intentionally separate from the immutable CFD
// resource tree returned by ProjectItems.
func (c *Client) ProjectDrafts(ctx context.Context, projectID string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "draft", "list", "--project-id", projectID)
}

// CreateDraft creates an editable remote Draft without starting meshing or a
// solver. Callers should use EnsureDraft when retrying a workflow so an
// uncertain response cannot create duplicate Drafts.
func (c *Client) CreateDraft(ctx context.Context, sourceID, name string) (json.RawMessage, error) {
	if strings.TrimSpace(sourceID) == "" {
		return nil, errors.New("Draft source ID is required")
	}
	args := []string{"draft", "create", strings.TrimSpace(sourceID)}
	if strings.TrimSpace(name) != "" {
		args = append(args, "--name", strings.TrimSpace(name))
	}
	return c.jsonCommand(ctx, args...)
}

// RenameDraft updates the display name of an existing editable Draft.
func (c *Client) RenameDraft(ctx context.Context, draftID, name string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "draft", "rename", strings.TrimSpace(draftID), "--name", strings.TrimSpace(name))
}

// DeleteDraft permanently removes an editable Draft after the caller has
// collected explicit user confirmation.
func (c *Client) DeleteDraft(ctx context.Context, draftID string) (json.RawMessage, error) {
	return c.jsonCommand(ctx, "draft", "delete", strings.TrimSpace(draftID), "--yes")
}

// EnsureDraft makes Draft creation idempotent by checking the Project-scoped
// list before creation and reconciling the name again after an uncertain create
// response. Draft creation is remote but does not start billable execution.
func (c *Client) EnsureDraft(ctx context.Context, projectID, sourceID, name string) (json.RawMessage, error) {
	if existing, err := c.FindReusableDraft(ctx, projectID, sourceID, name); err == nil {
		return existing, nil
	}
	created, createErr := c.CreateDraft(ctx, sourceID, name)
	if createErr == nil && draftIDFromPayload(created) != "" {
		return created, nil
	}
	if recovered, err := c.FindReusableDraft(ctx, projectID, sourceID, name); err == nil {
		return recovered, nil
	}
	if createErr != nil {
		return nil, createErr
	}
	return nil, errors.New("Flow360 created a Draft but did not return its ID")
}

// FindReusableDraft prefers the Draft Flow360 creates with a new Project. A
// source match is authoritative; the requested name is only a fallback for
// older CLI payloads that do not expose source metadata. A sole Draft without
// source metadata is safe to reuse because the list is Project-scoped.
func (c *Client) FindReusableDraft(ctx context.Context, projectID, sourceID, name string) (json.RawMessage, error) {
	raw, err := c.ProjectDrafts(ctx, projectID)
	if err != nil {
		return nil, err
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("parse Flow360 draft list: %w", err)
	}
	records := collectRecords(payload)
	normalizedSource := strings.TrimSpace(sourceID)
	normalizedName := strings.TrimSpace(name)
	var named map[string]any
	var sourceUnknown []map[string]any
	for _, record := range records {
		recordSource := firstString(record, "source_id", "source_item_id", "sourceId", "sourceItemId")
		if normalizedSource != "" && recordSource == normalizedSource {
			return draftRecordPayload(record)
		}
		if recordSource == "" {
			sourceUnknown = append(sourceUnknown, record)
		}
		if recordName, _ := record["name"].(string); recordSource == "" && normalizedName != "" && strings.TrimSpace(recordName) == normalizedName {
			named = record
		}
	}
	if named != nil {
		return draftRecordPayload(named)
	}
	if len(records) == 1 && len(sourceUnknown) == 1 {
		return draftRecordPayload(sourceUnknown[0])
	}
	return nil, errors.New("reusable Flow360 draft was not found")
}

func firstString(record map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := record[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func draftRecordPayload(record map[string]any) (json.RawMessage, error) {
	id := firstString(record, "draft_id", "id")
	if id == "" {
		return nil, errors.New("Flow360 Draft record did not include an ID")
	}
	record["draft_id"] = id
	return json.Marshal(record)
}

// SetDraftSimulationParams replaces the editable SimulationParams stored on a
// Draft, then reads the canonical representation back from Flow360. Using a
// private temporary file keeps large parameter trees out of process arguments
// and mirrors the flow360 CLI contract.
func (c *Client) SetDraftSimulationParams(ctx context.Context, draftID string, params json.RawMessage) (json.RawMessage, error) {
	if strings.TrimSpace(draftID) == "" {
		return nil, errors.New("draft ID is required")
	}
	if !json.Valid(params) {
		return nil, errors.New("SimulationParams must be valid JSON")
	}
	temp, err := os.CreateTemp("", "vibesim-draft-params-*.json")
	if err != nil {
		return nil, fmt.Errorf("create temporary SimulationParams file: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return nil, err
	}
	if _, err := temp.Write(params); err != nil {
		_ = temp.Close()
		return nil, err
	}
	if err := temp.Close(); err != nil {
		return nil, err
	}
	if _, err := c.run(ctx, "draft", "simulation-params", "set", draftID, tempPath); err != nil {
		return nil, err
	}
	raw, err := c.jsonCommand(ctx, "draft", "simulation-params", "get", draftID)
	if err != nil {
		return nil, err
	}
	return unwrapSimulationParamsPayload(raw), nil
}

func unwrapSimulationParamsPayload(raw json.RawMessage) json.RawMessage {
	var envelope struct {
		SimulationParams json.RawMessage `json:"simulation_params"`
	}
	if json.Unmarshal(raw, &envelope) == nil && len(envelope.SimulationParams) > 0 && json.Valid(envelope.SimulationParams) {
		return envelope.SimulationParams
	}
	return raw
}

func (c *Client) ResourceDetail(ctx context.Context, resourceType, resourceID string) (ResourceDetail, error) {
	detail, command, normalizedType, err := c.resourceMetadata(ctx, resourceType, resourceID)
	if err != nil {
		return ResourceDetail{}, err
	}

	type operation struct {
		name    string
		args    []string
		timeout time.Duration
		set     func(json.RawMessage)
	}
	operations := []operation{}
	if command == "case" {
		operations = append(operations, operation{
			name:    "results",
			args:    []string{"case", "results", "list", resourceID},
			timeout: c.resourceCommandTimeout(),
			set:     func(raw json.RawMessage) { detail.Results = raw },
		})
	}

	var (
		wait             sync.WaitGroup
		mu               sync.Mutex
		compatibilityErr error
	)
	for _, item := range operations {
		item := item
		wait.Add(1)
		go func() {
			defer wait.Done()
			raw, commandErr := c.jsonCommandWithTimeout(ctx, item.timeout, item.args...)
			mu.Lock()
			defer mu.Unlock()
			if commandErr != nil {
				detail.Errors[item.name] = commandErr.Error()
				return
			}
			item.set(raw)
		}()
	}
	wait.Add(1)
	go func() {
		defer wait.Done()
		var params, summary json.RawMessage
		var summaryErr, commandErr error
		if command == "draft" {
			params, commandErr = c.jsonCommandWithTimeout(
				ctx, c.resourceCommandTimeout(), command, "simulation-params", "get", resourceID,
			)
			if commandErr != nil {
				retry, upgradeErr := c.prepareCompatibleUpgrade(ctx, commandErr)
				if upgradeErr != nil {
					commandErr = upgradeErr
				} else if retry {
					params, commandErr = c.jsonCommandWithTimeout(
						ctx, c.resourceCommandTimeout(), command, "simulation-params", "get", resourceID,
					)
				}
			}
			params = unwrapSimulationParamsPayload(params)
		} else {
			params, summary, summaryErr, commandErr = c.resourceSimulationData(ctx, normalizedType, resourceID)
		}
		mu.Lock()
		defer mu.Unlock()
		if commandErr != nil {
			detail.Errors["simulation_params"] = commandErr.Error()
			if CompatibilityErrorCode(commandErr) != "" {
				compatibilityErr = commandErr
			}
			return
		}
		detail.SimulationParams = params
		detail.Summary = summary
		if summaryErr != nil {
			detail.Errors["summary"] = summaryErr.Error()
		}
	}()
	wait.Wait()
	return detail, compatibilityErr
}

// ResourceMetadata deliberately limits Project synchronization to the small,
// stable identity and state endpoints. SimulationParams and Case results can
// be tens of megabytes and are loaded only when a user explicitly needs the
// full resource detail.
func (c *Client) ResourceMetadata(ctx context.Context, resourceType, resourceID string) (ResourceDetail, error) {
	detail, _, _, err := c.resourceMetadata(ctx, resourceType, resourceID)
	return detail, err
}

func (c *Client) resourceMetadata(ctx context.Context, resourceType, resourceID string) (ResourceDetail, string, string, error) {
	command, normalizedType, err := resourceCommand(resourceType)
	if err != nil {
		return ResourceDetail{}, "", "", err
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
	}

	var (
		wait sync.WaitGroup
		mu   sync.Mutex
	)
	for _, item := range operations {
		item := item
		wait.Add(1)
		go func() {
			defer wait.Done()
			raw, commandErr := c.jsonCommandWithTimeout(ctx, c.commandTimeout(), item.args...)
			mu.Lock()
			defer mu.Unlock()
			if commandErr != nil {
				detail.Errors[item.name] = commandErr.Error()
				return
			}
			item.set(raw)
		}()
	}
	wait.Wait()
	return detail, command, normalizedType, nil
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

// ResourceState returns the lightweight lifecycle payload used by execution
// monitoring. Unlike ResourceDetail, it performs only one Flow360 CLI call.
func (c *Client) ResourceState(ctx context.Context, resourceType, resourceID string) (json.RawMessage, error) {
	command, _, err := resourceCommand(resourceType)
	if err != nil {
		return nil, err
	}
	return c.jsonCommand(ctx, command, "state", resourceID)
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

func (c *Client) DownloadCaseResultTo(ctx context.Context, resourceID, resultPath, outputDir string, maxSize int64) (string, error) {
	if strings.TrimSpace(outputDir) == "" {
		return "", errors.New("result output directory is required")
	}
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return "", fmt.Errorf("create case result directory: %w", err)
	}
	name := filepath.Base(resultPath)
	if name == "." || name == "" || name == ".." {
		return "", errors.New("invalid result path")
	}
	outputPath := filepath.Join(outputDir, name)
	downloadContext, cancelDownload := context.WithCancel(ctx)
	defer cancelDownload()
	var exceeded atomic.Bool
	monitorDone := make(chan struct{})
	if maxSize > 0 {
		go func() {
			ticker := time.NewTicker(500 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-monitorDone:
					return
				case <-ticker.C:
					if info, statErr := os.Stat(outputPath); statErr == nil && info.Size() > maxSize {
						exceeded.Store(true)
						cancelDownload()
						return
					}
				}
			}
		}()
	}
	_, runErr := c.runWithTimeout(
		downloadContext,
		30*time.Minute,
		"case", "results", "get", resourceID, resultPath,
		"--output", outputPath,
		"--overwrite",
	)
	close(monitorDone)
	if exceeded.Load() {
		_ = os.Remove(outputPath)
		return "", fmt.Errorf("result file exceeds %d byte analysis limit", maxSize)
	}
	if runErr != nil {
		return "", runErr
	}
	info, err := os.Stat(outputPath)
	if err != nil {
		return "", fmt.Errorf("inspect downloaded result: %w", err)
	}
	if maxSize > 0 && info.Size() > maxSize {
		_ = os.Remove(outputPath)
		return "", fmt.Errorf("result file exceeds %d byte analysis limit", maxSize)
	}
	if err := os.Chmod(outputPath, 0o600); err != nil {
		return "", err
	}
	return outputPath, nil
}

func (c *Client) ListCaseResults(ctx context.Context, caseID string) ([]string, error) {
	output, err := c.runWithTimeout(
		ctx,
		1*time.Minute,
		"case", "results", "list", caseID,
	)
	if err != nil {
		return nil, fmt.Errorf("list case results: %w", err)
	}

	raw, err := extractJSON(output)
	if err != nil {
		return nil, fmt.Errorf("parse results list: %w", err)
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("parse results list: %w", err)
	}
	return collectResultPaths(payload), nil
}

func collectResultPaths(value any) []string {
	var result []string
	switch typed := value.(type) {
	case string:
		return []string{typed}
	case []any:
		for _, item := range typed {
			result = append(result, collectResultPaths(item)...)
		}
	case map[string]any:
		if path, ok := typed["path"].(string); ok && path != "" {
			return []string{path}
		}
		if name, ok := typed["name"].(string); ok && name != "" {
			return []string{name}
		}
		for _, key := range []string{"records", "results", "items", "files"} {
			if nested, ok := typed[key]; ok {
				result = append(result, collectResultPaths(nested)...)
			}
		}
	}
	return result
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

// RunExistingDraft executes a Draft whose complete SimulationParams were
// already written and reviewed. It intentionally sends neither a name nor a
// patch, avoiding creation of another Draft at approval time.
func (c *Client) RunExistingDraft(ctx context.Context, draftID, target string) (json.RawMessage, error) {
	if strings.TrimSpace(draftID) == "" {
		return nil, errors.New("Draft ID is required")
	}
	output, err := c.runWithTimeout(ctx, 2*time.Minute, "draft", "run", strings.TrimSpace(draftID), "--up-to", target)
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

// FindDraftByName discovers a draft created before a server interruption.
// It is intentionally read-only and is used to reconcile an uncertain local
// submission without issuing another billable run.
func (c *Client) FindDraftByName(ctx context.Context, projectID, name string) (json.RawMessage, error) {
	raw, err := c.jsonCommand(ctx, "draft", "list", "--project-id", projectID)
	if err != nil {
		return nil, err
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("parse Flow360 draft list: %w", err)
	}
	records := collectRecords(payload)
	for _, record := range records {
		recordName, _ := record["name"].(string)
		if strings.TrimSpace(recordName) != strings.TrimSpace(name) {
			continue
		}
		if id, ok := record["id"].(string); ok && id != "" {
			record["draft_id"] = id
		}
		result, err := json.Marshal(record)
		if err != nil {
			return nil, err
		}
		return result, nil
	}
	return nil, errors.New("matching Flow360 draft was not found")
}

func draftIDFromPayload(raw json.RawMessage) string {
	var payload any
	if json.Unmarshal(raw, &payload) != nil {
		return ""
	}
	var visit func(any) string
	visit = func(value any) string {
		switch typed := value.(type) {
		case []any:
			for _, child := range typed {
				if id := visit(child); id != "" {
					return id
				}
			}
		case map[string]any:
			if id, _ := typed["draft_id"].(string); strings.TrimSpace(id) != "" {
				return strings.TrimSpace(id)
			}
			resourceType, _ := typed["type"].(string)
			if id, _ := typed["id"].(string); strings.EqualFold(strings.TrimSpace(resourceType), "Draft") && strings.TrimSpace(id) != "" {
				return strings.TrimSpace(id)
			}
			for _, child := range typed {
				if id := visit(child); id != "" {
					return id
				}
			}
		}
		return ""
	}
	return visit(payload)
}

// TerminalState represents the current state of a monitored resource
type TerminalState struct {
	State    string         `json:"state"`
	Terminal bool           `json:"terminal"`
	Details  map[string]any `json:"details,omitempty"`
}

// PollResourceTerminalState polls a resource until it reaches a terminal state.
// Terminal states are: completed, failed, cancelled, expired.
// Returns the final terminal state or an error if the context expires.
func (c *Client) PollResourceTerminalState(ctx context.Context, resourceType, resourceID string, interval time.Duration) (TerminalState, error) {
	if interval <= 0 {
		interval = 5 * time.Second
	}

	states := map[string]bool{
		"completed": true, "failed": true, "cancelled": true,
		"canceled": true, "expired": true, "success": true,
		"succeeded": true, "processed": true, "error": true,
		"diverged": true, "done": true, "timed_out": true,
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		detail, err := c.ResourceDetail(ctx, resourceType, resourceID)
		if err != nil {
			select {
			case <-ctx.Done():
				return TerminalState{State: "unknown", Terminal: false}, ctx.Err()
			case <-ticker.C:
				continue
			}
		}

		state := extractState(detail.State)
		if state == "" {
			state = extractState(detail.Summary)
		}

		if states[strings.ToLower(state)] {
			return TerminalState{
				State:    state,
				Terminal: true,
				Details:  map[string]any{"id": detail.ID, "type": detail.Type},
			}, nil
		}

		select {
		case <-ctx.Done():
			return TerminalState{State: state, Terminal: false}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func extractState(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return ""
	}
	for _, key := range []string{"state", "status", "phase", "result"} {
		if val, ok := data[key]; ok {
			if s, ok := val.(string); ok {
				return s
			}
		}
	}
	return ""
}

func collectRecords(value any) []map[string]any {
	switch typed := value.(type) {
	case []any:
		result := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if record, ok := item.(map[string]any); ok {
				result = append(result, record)
			}
		}
		return result
	case map[string]any:
		for _, key := range []string{"records", "drafts", "items"} {
			if nested, ok := typed[key]; ok {
				return collectRecords(nested)
			}
		}
	}
	return nil
}

func (c *Client) CreateProject(ctx context.Context, files []string, sourceType, name, unit, workflow, solverVersion, folderID string, tags []string) (json.RawMessage, error) {
	return c.createProject(ctx, files, sourceType, name, unit, workflow, solverVersion, folderID, tags, false)
}

// CreateProjectSync waits for the uploaded root resource to finish processing.
// AI Create needs the root ID immediately so it can attach its generated plan.
func (c *Client) CreateProjectSync(ctx context.Context, files []string, sourceType, name, unit, workflow, solverVersion, folderID string, tags []string) (json.RawMessage, error) {
	return c.createProject(ctx, files, sourceType, name, unit, workflow, solverVersion, folderID, tags, true)
}

func (c *Client) createProject(ctx context.Context, files []string, sourceType, name, unit, workflow, solverVersion, folderID string, tags []string, syncRoot bool) (json.RawMessage, error) {
	args := []string{"project", "create"}
	args = append(args, files...)
	args = append(args, "--from", sourceType, "--name", name, "--unit", unit)
	if syncRoot {
		args = append(args, "--sync")
	}
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
	result := map[string]any{"output": compactProjectOutput(output)}
	raw, err := extractJSON(output)
	if err == nil {
		var parsed any
		if json.Unmarshal(raw, &parsed) == nil {
			result["result"] = parsed
		}
	}
	return json.Marshal(result)
}

func compactProjectOutput(data []byte) string {
	const limit = 16 * 1024
	value := strings.Join(strings.Fields(string(data)), " ")
	if len(value) > limit {
		return value[:limit] + "…"
	}
	return value
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
	case "draft":
		return "draft", "Draft", nil
	default:
		return "", "", fmt.Errorf("unsupported resource type %q", resourceType)
	}
}

func (c *Client) jsonCommand(ctx context.Context, args ...string) (json.RawMessage, error) {
	return c.jsonCommandWithTimeout(ctx, c.commandTimeout(), args...)
}

func (c *Client) jsonCommandWithTimeout(ctx context.Context, timeout time.Duration, args ...string) (json.RawMessage, error) {
	output, err := c.runWithTimeout(ctx, timeout, args...)
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
	return c.runWithTimeout(parent, c.commandTimeout(), args...)
}

func (c *Client) runWithTimeout(parent context.Context, timeout time.Duration, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	commandArgs := c.commandArgs(args...)
	cmd := exec.CommandContext(ctx, c.runtimeBinary(), commandArgs...)
	if c.APIKey != "" {
		cmd.Env = append(os.Environ(), "FLOW360_APIKEY="+c.APIKey)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("flow360 command timed out after %s", timeout)
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
