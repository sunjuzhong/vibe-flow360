package plans

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	StatusDraft       = "draft"
	StatusApproved    = "approved"
	StatusRunning     = "running"
	StatusSubmitted   = "submitted"
	StatusFailed      = "failed"
	StatusReconciling = "reconciling"
	StatusCompleted   = "completed"

	ErrNotApproved         = "plan must be approved before execution"
	ErrPreflightRequired   = "plan must pass Flow360 schema preflight"
	ErrAlreadySubmitted    = "plan has already been submitted to Flow360"
	ErrValidationErrors    = "plan has validation errors"
	ErrDoubleSubmitProtect = "plan execution is already in progress or completed"
)

type ErrorCategory string

const (
	ErrorTimeout      ErrorCategory = "timeout"
	ErrorAuth         ErrorCategory = "authentication"
	ErrorValidation   ErrorCategory = "validation"
	ErrorNetwork      ErrorCategory = "network"
	ErrorUnknown      ErrorCategory = "unknown"
	ErrorDoubleSubmit ErrorCategory = "double_submit"
)

type RemoteIDs struct {
	ProjectID     string `json:"project_id,omitempty"`
	DraftID       string `json:"draft_id,omitempty"`
	GeometryID    string `json:"geometry_id,omitempty"`
	MeshID        string `json:"mesh_id,omitempty"`
	CaseID        string `json:"case_id,omitempty"`
	SolverVersion string `json:"solver_version,omitempty"`
}

type Validation struct {
	Level   string `json:"level"`
	Field   string `json:"field,omitempty"`
	Message string `json:"message"`
}

type Difference struct {
	Path   string `json:"path"`
	Before any    `json:"before,omitempty"`
	After  any    `json:"after,omitempty"`
	Kind   string `json:"kind"`
}

type Evidence struct {
	Key         string `json:"key"`
	Value       any    `json:"value"`
	Provenance  string `json:"provenance"`
	Description string `json:"description,omitempty"`
}

type PreflightIssue struct {
	Level   string   `json:"level"`
	Code    string   `json:"code"`
	Path    string   `json:"path,omitempty"`
	Message string   `json:"message"`
	Stages  []string `json:"stages,omitempty"`
}

type Preflight struct {
	SchemaVersion     int              `json:"schema_version"`
	ValidatorVersion  string           `json:"validator_version,omitempty"`
	Valid             bool             `json:"valid"`
	ValidatedRevision int              `json:"validated_revision"`
	Issues            []PreflightIssue `json:"issues"`
	FormSchema        json.RawMessage  `json:"form_schema"`
	ValidatedAt       time.Time        `json:"validated_at"`
}

type Plan struct {
	ID              string          `json:"id"`
	ProjectID       string          `json:"project_id"`
	ProjectName     string          `json:"project_name,omitempty"`
	SourceID        string          `json:"source_id"`
	SourceType      string          `json:"source_type"`
	SourceName      string          `json:"source_name,omitempty"`
	Target          string          `json:"target"`
	Name            string          `json:"name"`
	Intent          string          `json:"intent"`
	Patch           json.RawMessage `json:"patch"`
	Baseline        json.RawMessage `json:"-"`
	Differences     []Difference    `json:"differences"`
	Validations     []Validation    `json:"validations"`
	Evidence        []Evidence      `json:"evidence,omitempty"`
	ValidationHints []string        `json:"validation_hints,omitempty"`
	Revision        int             `json:"revision"`
	Preflight       *Preflight      `json:"preflight,omitempty"`
	CommandPreview  []string        `json:"command_preview"`
	Status          string          `json:"status"`
	ApprovedAt      *time.Time      `json:"approved_at,omitempty"`
	StartedAt       *time.Time      `json:"started_at,omitempty"`
	CompletedAt     *time.Time      `json:"completed_at,omitempty"`
	Result          json.RawMessage `json:"result,omitempty"`
	Error           string          `json:"error,omitempty"`
	ErrorCategory   ErrorCategory   `json:"error_category,omitempty"`
	IdempotencyKey  string          `json:"idempotency_key,omitempty"`
	SubmissionID    string          `json:"submission_id,omitempty"`
	RemoteIDs       *RemoteIDs      `json:"remote_ids,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type CreateInput struct {
	ProjectID       string
	ProjectName     string
	SourceID        string
	SourceType      string
	SourceName      string
	Target          string
	Name            string
	Intent          string
	Patch           json.RawMessage
	Baseline        json.RawMessage
	Evidence        []Evidence
	ValidationHints []string
	IdempotencyKey  string
}

type Store struct {
	dir string
	mu  sync.Mutex
}

func NewStore(dir string) (*Store, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		dir = ".vibesim/plans"
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create plan store: %w", err)
	}
	store := &Store{dir: dir}
	if err := store.recoverInterrupted(); err != nil {
		return nil, fmt.Errorf("recover plan store: %w", err)
	}
	return store, nil
}

func (s *Store) Create(input CreateInput) (Plan, error) {
	plan, err := Compile(input)
	if err != nil {
		return Plan{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if plan.IdempotencyKey != "" {
		if existing, ok := s.findByIdempotencyKey(plan.IdempotencyKey); ok {
			return existing, nil
		}
	}
	if err := s.write(plan); err != nil {
		return Plan{}, err
	}
	return plan, nil
}

func (s *Store) Get(id string) (Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(id)
}

func (s *Store) List(projectID, sourceID string) ([]Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	result := make([]Plan, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		plan, readErr := s.read(strings.TrimSuffix(entry.Name(), ".json"))
		if readErr != nil {
			continue
		}
		if projectID != "" && plan.ProjectID != projectID {
			continue
		}
		if sourceID != "" && plan.SourceID != sourceID {
			continue
		}
		result = append(result, plan)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func (s *Store) Update(id string, mutate func(*Plan) error) (Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, err := s.read(id)
	if err != nil {
		return Plan{}, err
	}
	if err := mutate(&plan); err != nil {
		return Plan{}, err
	}
	plan.UpdatedAt = time.Now().UTC()
	if err := s.write(plan); err != nil {
		return Plan{}, err
	}
	return plan, nil
}

func Compile(input CreateInput) (Plan, error) {
	input.ProjectID = strings.TrimSpace(input.ProjectID)
	input.SourceID = strings.TrimSpace(input.SourceID)
	input.SourceType = normalizeType(input.SourceType)
	input.Target = strings.ToLower(strings.TrimSpace(input.Target))
	input.Name = strings.TrimSpace(input.Name)
	input.Intent = strings.TrimSpace(input.Intent)
	if input.ProjectID == "" || input.SourceID == "" || input.SourceType == "" {
		return Plan{}, errors.New("project, source resource, and source type are required")
	}
	if input.Name == "" {
		return Plan{}, errors.New("plan name is required")
	}
	if len(input.Name) > 120 {
		return Plan{}, errors.New("plan name must be 120 characters or fewer")
	}
	if !validTarget(input.SourceType, input.Target) {
		return Plan{}, fmt.Errorf("%s cannot run up to %s", input.SourceType, input.Target)
	}
	if input.Intent == "" {
		input.Intent = fmt.Sprintf(
			"Compile and validate reviewed parameters for %s → %s.",
			input.SourceType,
			normalizeType(input.Target),
		)
	}
	if len(input.Patch) == 0 {
		input.Patch = json.RawMessage(`{}`)
	}
	if len(input.Patch) > 256<<10 {
		return Plan{}, errors.New("SimulationParams patch exceeds 256 KB")
	}

	var patch any
	if err := json.Unmarshal(input.Patch, &patch); err != nil {
		return Plan{}, errors.New("SimulationParams patch must be valid JSON")
	}
	patchObject, ok := patch.(map[string]any)
	if !ok {
		return Plan{}, errors.New("SimulationParams patch must be a JSON object")
	}
	var baseline any = map[string]any{}
	if len(input.Baseline) > 0 {
		if err := json.Unmarshal(input.Baseline, &baseline); err != nil {
			return Plan{}, errors.New("Flow360 baseline SimulationParams is invalid")
		}
		baseline = unwrapSimulationParams(baseline)
	}

	validations := validatePatch(patchObject)
	merged := mergePatch(baseline, patchObject)
	differences := make([]Difference, 0)
	diffValues("", baseline, merged, &differences)
	if len(differences) == 0 {
		validations = append(validations, Validation{
			Level: "warning", Field: "patch", Message: "Patch does not change the current SimulationParams.",
		})
	}
	validations = append(validations,
		Validation{Level: "success", Field: "source", Message: "Source resource and target stage are compatible."},
		Validation{Level: "success", Field: "approval", Message: "Remote execution remains locked until this exact plan is approved."},
	)

	id, err := newID()
	if err != nil {
		return Plan{}, err
	}
	now := time.Now().UTC()
	return Plan{
		ID:              id,
		ProjectID:       input.ProjectID,
		ProjectName:     strings.TrimSpace(input.ProjectName),
		SourceID:        input.SourceID,
		SourceType:      input.SourceType,
		SourceName:      strings.TrimSpace(input.SourceName),
		Target:          input.Target,
		Name:            input.Name,
		Intent:          input.Intent,
		Patch:           append(json.RawMessage(nil), input.Patch...),
		Baseline:        append(json.RawMessage(nil), input.Baseline...),
		Differences:     differences,
		Validations:     validations,
		Evidence:        append([]Evidence(nil), input.Evidence...),
		ValidationHints: append([]string(nil), input.ValidationHints...),
		Revision:        1,
		CommandPreview:  []string{"flow360", "draft", "run", input.SourceID, "--name", input.Name, "--patch", "<temporary-patch.json>", "--up-to", input.Target},
		Status:          StatusDraft,
		IdempotencyKey:  strings.TrimSpace(input.IdempotencyKey),
		CreatedAt:       now,
		UpdatedAt:       now,
	}, nil
}

func (s *Store) findByIdempotencyKey(key string) (Plan, bool) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return Plan{}, false
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		plan, err := s.read(strings.TrimSuffix(entry.Name(), ".json"))
		if err == nil && plan.IdempotencyKey == key {
			return plan, true
		}
	}
	return Plan{}, false
}

func (s *Store) read(id string) (Plan, error) {
	if !validID(id) {
		return Plan{}, errors.New("invalid plan id")
	}
	data, err := os.ReadFile(filepath.Join(s.dir, id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return Plan{}, errors.New("plan not found")
	}
	if err != nil {
		return Plan{}, err
	}
	var stored struct {
		Plan
		Baseline json.RawMessage `json:"baseline,omitempty"`
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		return Plan{}, err
	}
	stored.Plan.Baseline = stored.Baseline
	return stored.Plan, nil
}

func (s *Store) write(plan Plan) error {
	data, err := json.MarshalIndent(struct {
		Plan
		Baseline json.RawMessage `json:"baseline,omitempty"`
	}{
		Plan: plan, Baseline: plan.Baseline,
	}, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(s.dir, plan.ID+".json")
	temp, err := os.CreateTemp(s.dir, ".plan-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, path)
}

func (s *Store) recoverInterrupted() error {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		plan, readErr := s.read(id)
		if readErr != nil {
			continue
		}
		if plan.Status == StatusRunning {
			now := time.Now().UTC()
			plan.Status = StatusReconciling
			plan.Error = "Server restarted during execution. Reconciling with Flow360 remote state..."
			plan.ErrorCategory = ErrorUnknown
			plan.CompletedAt = &now
			plan.UpdatedAt = now
			if err := s.write(plan); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) CanRun(id string) (Plan, error) {
	plan, err := s.Get(id)
	if err != nil {
		return Plan{}, err
	}
	if plan.SubmissionID != "" {
		return Plan{}, errors.New(ErrDoubleSubmitProtect)
	}
	if plan.Status != StatusApproved && plan.Status != StatusFailed {
		return Plan{}, errors.New(ErrNotApproved)
	}
	if plan.Preflight == nil || !plan.Preflight.Valid || plan.Preflight.ValidatedRevision != plan.Revision {
		return Plan{}, errors.New(ErrPreflightRequired)
	}
	return plan, nil
}

func (s *Store) MarkReconcilePending(id string, reconcileErr error) (Plan, error) {
	return s.Update(id, func(plan *Plan) error {
		if plan.Status != StatusReconciling {
			return errors.New("only interrupted plans can be reconciled")
		}
		plan.Error = "Remote submission is still uncertain; execution remains locked to prevent duplicate Flow360 resources."
		if reconcileErr != nil {
			plan.Error += " " + reconcileErr.Error()
			plan.ErrorCategory = classifyError(reconcileErr)
		}
		return nil
	})
}

func classifyError(err error) ErrorCategory {
	if err == nil {
		return ""
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "timeout"), strings.Contains(msg, "deadline exceeded"), strings.Contains(msg, "context deadline"):
		return ErrorTimeout
	case strings.Contains(msg, "unauthorized"), strings.Contains(msg, "401"), strings.Contains(msg, "403"), strings.Contains(msg, "authentication"):
		return ErrorAuth
	case strings.Contains(msg, "validation"), strings.Contains(msg, "invalid"), strings.Contains(msg, "400"):
		return ErrorValidation
	case strings.Contains(msg, "connection"), strings.Contains(msg, "network"), strings.Contains(msg, "dns"), strings.Contains(msg, "502"), strings.Contains(msg, "503"):
		return ErrorNetwork
	default:
		return ErrorUnknown
	}
}

func extractRemoteIDs(result json.RawMessage) *RemoteIDs {
	if len(result) == 0 {
		return nil
	}
	var data map[string]interface{}
	if err := json.Unmarshal(result, &data); err != nil {
		return nil
	}
	ids := &RemoteIDs{}
	if pid, ok := data["project_id"].(string); ok {
		ids.ProjectID = pid
	}
	if did, ok := data["draft_id"].(string); ok {
		ids.DraftID = did
	}
	if gid, ok := data["geometry_id"].(string); ok {
		ids.GeometryID = gid
	}
	if mid, ok := data["mesh_id"].(string); ok {
		ids.MeshID = mid
	}
	if cid, ok := data["case_id"].(string); ok {
		ids.CaseID = cid
	}
	if sv, ok := data["solver_version"].(string); ok {
		ids.SolverVersion = sv
	}
	if ids.ProjectID == "" && ids.DraftID == "" && ids.GeometryID == "" && ids.MeshID == "" && ids.CaseID == "" {
		return nil
	}
	return ids
}

func (s *Store) SetRunning(id, submissionID string) (Plan, error) {
	return s.Update(id, func(plan *Plan) error {
		if plan.Status != StatusApproved && plan.Status != StatusFailed {
			return errors.New(ErrNotApproved)
		}
		if plan.Preflight == nil || !plan.Preflight.Valid || plan.Preflight.ValidatedRevision != plan.Revision {
			return errors.New(ErrPreflightRequired)
		}
		now := time.Now().UTC()
		plan.Status = StatusRunning
		plan.StartedAt = &now
		plan.CompletedAt = nil
		plan.Error = ""
		plan.ErrorCategory = ""
		plan.SubmissionID = submissionID
		return nil
	})
}

func (s *Store) SetPreflight(id string, result Preflight) (Plan, error) {
	return s.Update(id, func(plan *Plan) error {
		if result.ValidatedRevision != plan.Revision {
			return errors.New("preflight result is stale")
		}
		if !json.Valid(result.FormSchema) {
			return errors.New("preflight form schema is invalid")
		}
		result.ValidatedAt = time.Now().UTC()
		plan.Preflight = &result
		if plan.Status == StatusFailed && plan.ErrorCategory == ErrorValidation {
			plan.Error = "Flow360 rejected the simulation configuration. Complete the required schema inputs and validate again."
		}
		return nil
	})
}

func (s *Store) SetBaseline(id string, baseline json.RawMessage) (Plan, error) {
	if len(baseline) == 0 || !json.Valid(baseline) {
		return Plan{}, errors.New("Flow360 baseline SimulationParams is invalid")
	}
	return s.Update(id, func(plan *Plan) error {
		if len(plan.Baseline) == 0 {
			plan.Baseline = append(json.RawMessage(nil), baseline...)
		}
		if plan.Revision == 0 {
			plan.Revision = 1
		}
		return nil
	})
}

func (s *Store) ApplyInputs(id string, revision int, values json.RawMessage) (Plan, error) {
	return s.applyInputs(id, revision, values, false)
}

// ApplySchemaInputs accepts values expanded exclusively from a server-issued
// form schema. Expansion may preserve Flow360 private entity metadata from the
// stored baseline; browser-submitted values never enter this method directly.
func (s *Store) ApplySchemaInputs(id string, revision int, values json.RawMessage) (Plan, error) {
	return s.applyInputs(id, revision, values, true)
}

func (s *Store) applyInputs(id string, revision int, values json.RawMessage, schemaExpanded bool) (Plan, error) {
	maxSize := 256 << 10
	if schemaExpanded {
		// Schema expansion may preserve an existing models array containing
		// Flow360 entity metadata that was never sent by the browser.
		maxSize = 2 << 20
	}
	if len(values) == 0 || len(values) > maxSize {
		return Plan{}, fmt.Errorf("dynamic form values must be between 1 byte and %d KB", maxSize>>10)
	}
	var valueObject map[string]any
	if err := json.Unmarshal(values, &valueObject); err != nil {
		return Plan{}, errors.New("dynamic form values must be a JSON object")
	}
	if !schemaExpanded {
		for _, validation := range validatePatch(valueObject) {
			if validation.Level == "error" {
				return Plan{}, errors.New(validation.Message)
			}
		}
	}
	return s.Update(id, func(plan *Plan) error {
		if plan.Revision == 0 {
			plan.Revision = 1
		}
		if revision != plan.Revision {
			return errors.New("plan revision is stale")
		}
		switch plan.Status {
		case StatusDraft, StatusApproved, StatusFailed:
		default:
			return fmt.Errorf("a %s plan cannot be edited", plan.Status)
		}
		var patchObject map[string]any
		if err := json.Unmarshal(plan.Patch, &patchObject); err != nil {
			return errors.New("stored plan patch is invalid")
		}
		mergedPatch := mergePatch(patchObject, valueObject)
		patch, err := json.Marshal(mergedPatch)
		if err != nil {
			return err
		}
		recompiled, err := Compile(CreateInput{
			ProjectID: plan.ProjectID, ProjectName: plan.ProjectName,
			SourceID: plan.SourceID, SourceType: plan.SourceType, SourceName: plan.SourceName,
			Target: plan.Target, Name: plan.Name, Intent: plan.Intent,
			Patch: patch, Baseline: plan.Baseline, Evidence: plan.Evidence,
			ValidationHints: plan.ValidationHints, IdempotencyKey: plan.IdempotencyKey,
		})
		if err != nil {
			return err
		}
		plan.Patch = recompiled.Patch
		plan.Differences = recompiled.Differences
		plan.Validations = recompiled.Validations
		plan.CommandPreview = recompiled.CommandPreview
		plan.Revision++
		plan.Preflight = nil
		plan.Status = StatusDraft
		plan.ApprovedAt = nil
		plan.StartedAt = nil
		plan.CompletedAt = nil
		plan.Result = nil
		plan.Error = ""
		plan.ErrorCategory = ""
		plan.SubmissionID = ""
		plan.RemoteIDs = nil
		return nil
	})
}

func MergedSimulationParams(plan Plan) (json.RawMessage, error) {
	var baseline any = map[string]any{}
	if len(plan.Baseline) > 0 {
		if err := json.Unmarshal(plan.Baseline, &baseline); err != nil {
			return nil, errors.New("stored Flow360 baseline SimulationParams is invalid")
		}
		baseline = unwrapSimulationParams(baseline)
	}
	var patch any
	if err := json.Unmarshal(plan.Patch, &patch); err != nil {
		return nil, errors.New("stored plan patch is invalid")
	}
	result, err := json.Marshal(mergePatch(baseline, patch))
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Store) MarkSubmitted(id string, result json.RawMessage) (Plan, error) {
	remoteIDs := extractRemoteIDs(result)
	return s.Update(id, func(plan *Plan) error {
		plan.Status = StatusSubmitted
		plan.CompletedAt = nil
		plan.Result = result
		plan.RemoteIDs = remoteIDs
		plan.Error = ""
		plan.ErrorCategory = ""
		return nil
	})
}

func (s *Store) MarkFailed(id string, runErr error) (Plan, error) {
	category := classifyError(runErr)
	return s.Update(id, func(plan *Plan) error {
		now := time.Now().UTC()
		plan.Status = StatusFailed
		plan.CompletedAt = &now
		plan.Error = runErr.Error()
		plan.ErrorCategory = category
		plan.SubmissionID = ""
		return nil
	})
}

func (s *Store) MarkComplete(id string, results map[string]any) (Plan, error) {
	resultJSON, _ := json.Marshal(results)
	return s.Update(id, func(plan *Plan) error {
		now := time.Now().UTC()
		plan.Status = StatusCompleted
		plan.CompletedAt = &now
		plan.Result = resultJSON
		plan.Error = ""
		plan.ErrorCategory = ""
		return nil
	})
}

func validTarget(sourceType, target string) bool {
	switch sourceType {
	case "Geometry":
		return target == "surface-mesh" || target == "volume-mesh" || target == "case"
	case "SurfaceMesh":
		return target == "volume-mesh" || target == "case"
	case "VolumeMesh", "Case":
		return target == "case"
	default:
		return false
	}
}

func normalizeType(value string) string {
	switch strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(value), "-", ""), "_", "")) {
	case "geometry":
		return "Geometry"
	case "surfacemesh":
		return "SurfaceMesh"
	case "volumemesh":
		return "VolumeMesh"
	case "case":
		return "Case"
	default:
		return ""
	}
}

func validatePatch(patch map[string]any) []Validation {
	result := []Validation{{
		Level: "success", Field: "patch", Message: "Patch is a valid JSON merge-patch object.",
	}}
	var walk func(string, any)
	walk = func(path string, value any) {
		switch typed := value.(type) {
		case map[string]any:
			for key, child := range typed {
				childPath := key
				if path != "" {
					childPath = path + "." + key
				}
				lower := strings.ToLower(key)
				if strings.HasPrefix(lower, "private_attribute") {
					result = append(result, Validation{Level: "error", Field: childPath, Message: "Private Flow360 attributes cannot be patched from the Web."})
				}
				walk(childPath, child)
			}
		case nil:
			result = append(result, Validation{Level: "warning", Field: path, Message: "A null value removes this field through JSON merge-patch semantics."})
		case float64:
			lowerPath := strings.ToLower(path)
			switch {
			case strings.HasSuffix(lowerPath, "operating_condition.alpha.value"),
				strings.HasSuffix(lowerPath, "operating_condition.beta.value"):
				if typed < -90 || typed > 90 {
					result = append(result, Validation{Level: "error", Field: path, Message: "Aerodynamic angle must be between -90 and 90 degrees."})
				} else {
					result = append(result, Validation{Level: "success", Field: path, Message: "Aerodynamic angle is within the supported range."})
				}
			case strings.HasSuffix(lowerPath, "velocity_magnitude.value"):
				if typed <= 0 {
					result = append(result, Validation{Level: "error", Field: path, Message: "Velocity magnitude must be greater than zero."})
				}
			case strings.HasSuffix(lowerPath, "time_stepping.max_steps"):
				if typed < 1 || typed != float64(int64(typed)) {
					result = append(result, Validation{Level: "error", Field: path, Message: "Maximum steps must be a positive integer."})
				}
			}
		}
	}
	walk("", patch)
	if len(patch) == 0 {
		result = append(result, Validation{Level: "warning", Field: "patch", Message: "No SimulationParams changes are included."})
	}
	return result
}

func unwrapSimulationParams(value any) any {
	current := value
	for _, key := range []string{"simulation_params"} {
		object, ok := current.(map[string]any)
		if !ok {
			break
		}
		next, exists := object[key]
		if !exists {
			break
		}
		current = next
	}
	return current
}

func mergePatch(target, patch any) any {
	patchObject, ok := patch.(map[string]any)
	if !ok {
		return patch
	}
	targetObject, ok := target.(map[string]any)
	if !ok {
		targetObject = map[string]any{}
	}
	result := make(map[string]any, len(targetObject))
	for key, value := range targetObject {
		result[key] = value
	}
	for key, value := range patchObject {
		if value == nil {
			delete(result, key)
			continue
		}
		result[key] = mergePatch(result[key], value)
	}
	return result
}

func diffValues(path string, before, after any, result *[]Difference) {
	beforeObject, beforeOK := before.(map[string]any)
	afterObject, afterOK := after.(map[string]any)
	if beforeOK && afterOK {
		keys := map[string]struct{}{}
		for key := range beforeObject {
			keys[key] = struct{}{}
		}
		for key := range afterObject {
			keys[key] = struct{}{}
		}
		ordered := make([]string, 0, len(keys))
		for key := range keys {
			ordered = append(ordered, key)
		}
		sort.Strings(ordered)
		for _, key := range ordered {
			childPath := key
			if path != "" {
				childPath = path + "." + key
			}
			beforeValue, hasBefore := beforeObject[key]
			afterValue, hasAfter := afterObject[key]
			switch {
			case !hasBefore:
				*result = append(*result, Difference{Path: childPath, After: afterValue, Kind: "added"})
			case !hasAfter:
				*result = append(*result, Difference{Path: childPath, Before: beforeValue, Kind: "removed"})
			default:
				diffValues(childPath, beforeValue, afterValue, result)
			}
		}
		return
	}
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	if string(beforeJSON) != string(afterJSON) {
		*result = append(*result, Difference{Path: path, Before: before, After: after, Kind: "changed"})
	}
}

func newID() (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "plan-" + hex.EncodeToString(bytes), nil
}

func validID(id string) bool {
	if !strings.HasPrefix(id, "plan-") || len(id) != 21 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(id, "plan-"))
	return err == nil
}
