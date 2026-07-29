package agent

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	// Intervention states
	InterventionObservation    = "observation"
	InterventionDiagnosis      = "diagnosis"
	InterventionProposal       = "proposal"
	InterventionUserFeedback   = "user_feedback"
	InterventionPatchCompile   = "patch_compile"
	InterventionValidation     = "validation"
	InterventionResolved       = "resolved"
	InterventionFailed         = "failed"
	InterventionClosed         = "closed"

	// Intervention types
	TypePreflightError    = "preflight_error"
	TypeMeshFailure       = "mesh_failure"
	TypeSolverFailure    = "solver_failure"
	TypeConvergenceAnomaly = "convergence_anomaly"
	TypeRemoteError       = "remote_error"

	// Error categories for interventions
	ErrorMissingInputs    = "missing_inputs"
	ErrorSchemaViolation  = "schema_violation"
	ErrorMeshQuality      = "mesh_quality"
	ErrorSolverDivergence = "solver_divergence"
	ErrorTimeout          = "timeout"
	ErrorAuthentication   = "authentication"
	ErrorNetwork          = "network"
	ErrorUnknown          = "unknown"
)

var (
	ErrInvalidInterventionState = errors.New("invalid intervention state transition")
	ErrInterventionNotFound     = errors.New("intervention not found")
	ErrCannotResolveIntervention = errors.New("cannot resolve intervention: validation required")
)

// Intervention represents an agent-mediated recovery process
type Intervention struct {
	ID              string          `json:"id"`
	ProjectID       string          `json:"project_id"`
	ProjectName     string          `json:"project_name,omitempty"`
	ResourceID      string          `json:"resource_id,omitempty"`
	ResourceType    string          `json:"resource_type,omitempty"`
	PlanID          string          `json:"plan_id,omitempty"`
	PlanRevision    int             `json:"plan_revision,omitempty"`
	Type            string          `json:"type"`
	State           string          `json:"state"`
	Reason          string          `json:"reason"`
	Confidence      float64         `json:"confidence"`
	Impact          string          `json:"impact,omitempty"`
	Evidence        []Evidence      `json:"evidence,omitempty"`
	Diagnosis       *Diagnosis      `json:"diagnosis,omitempty"`
	Proposals       []Proposal      `json:"proposals,omitempty"`
	SelectedProposal *Proposal     `json:"selected_proposal,omitempty"`
	UserFeedback    string          `json:"user_feedback,omitempty"`
	RequiresConfirm []string        `json:"requires_confirmation,omitempty"`
	CurrentPatch    json.RawMessage `json:"current_patch,omitempty"`
	CompiledPatch   json.RawMessage `json:"compiled_patch,omitempty"`
	Validation      *ValidationResult `json:"validation,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	ResolvedAt      *time.Time      `json:"resolved_at,omitempty"`
	ClosedAt        *time.Time      `json:"closed_at,omitempty"`
}

// Evidence represents supporting information for diagnosis
type Evidence struct {
	Type    string          `json:"type"`
	Content json.RawMessage `json:"content"`
	Source  string          `json:"source"`
	Timestamp time.Time     `json:"timestamp"`
}

// Diagnosis represents the agent's analysis of the issue
type Diagnosis struct {
	RootCause       string   `json:"root_cause"`
	Category        string   `json:"category"`
	Severity        string   `json:"severity"`
	ContributingFactors []string `json:"contributing_factors,omitempty"`
	RecommendedActions  []string `json:"recommended_actions,omitempty"`
}

// ValidationResult contains the outcome of local validation
type ValidationResult struct {
	Valid      bool     `json:"valid"`
	Errors     []string `json:"errors,omitempty"`
	Warnings   []string `json:"warnings,omitempty"`
	PreflightID string   `json:"preflight_id,omitempty"`
}

// InterventionInput is used to create a new intervention
type InterventionInput struct {
	ProjectID    string
	ProjectName  string
	ResourceID   string
	ResourceType string
	PlanID       string
	Type         string
	Reason       string
	Evidence     []Evidence
	CurrentPatch json.RawMessage
}

// NewIntervention creates a new Intervention
func NewIntervention(input InterventionInput) (Intervention, error) {
	id, err := newInterventionID()
	if err != nil {
		return Intervention{}, fmt.Errorf("generate intervention ID: %w", err)
	}

	now := time.Now().UTC()
	return Intervention{
		ID:           id,
		ProjectID:    input.ProjectID,
		ProjectName:  input.ProjectName,
		ResourceID:   input.ResourceID,
		ResourceType: input.ResourceType,
		PlanID:       input.PlanID,
		Type:         input.Type,
		State:        InterventionObservation,
		Reason:       input.Reason,
		Confidence:   0.0,
		Evidence:     input.Evidence,
		CurrentPatch: input.CurrentPatch,
		CreatedAt:    now,
		UpdatedAt:    now,
	}, nil
}

// RunDiagnosis transitions the intervention to diagnosis state
func (i *Intervention) RunDiagnosis(diagnosis Diagnosis) error {
	if i.State != InterventionObservation {
		return ErrInvalidInterventionState
	}
	i.State = InterventionDiagnosis
	i.Diagnosis = &diagnosis
	i.UpdatedAt = time.Now().UTC()
	return nil
}

// GenerateProposals adds proposals and transitions to proposal state
func (i *Intervention) GenerateProposals(proposals []Proposal) error {
	if i.State != InterventionDiagnosis {
		return ErrInvalidInterventionState
	}
	i.State = InterventionProposal
	i.Proposals = proposals
	i.Confidence = averageConfidence(proposals)
	i.RequiresConfirm = extractRequiresConfirmation(proposals)
	i.UpdatedAt = time.Now().UTC()
	return nil
}

// SelectProposal selects a proposal and records user feedback
func (i *Intervention) SelectProposal(proposal Proposal, feedback string) error {
	if i.State != InterventionProposal && i.State != InterventionUserFeedback {
		return ErrInvalidInterventionState
	}
	i.State = InterventionUserFeedback
	i.SelectedProposal = &proposal
	i.UserFeedback = feedback
	i.UpdatedAt = time.Now().UTC()
	return nil
}

// CompilePatch transitions to patch_compile state
func (i *Intervention) CompilePatch(compiled json.RawMessage) error {
	if i.State != InterventionUserFeedback {
		return ErrInvalidInterventionState
	}
	i.State = InterventionPatchCompile
	i.CompiledPatch = compiled
	i.UpdatedAt = time.Now().UTC()
	return nil
}

// Validate transitions to validation state
func (i *Intervention) Validate() error {
	if i.State != InterventionPatchCompile {
		return ErrInvalidInterventionState
	}
	i.State = InterventionValidation
	i.UpdatedAt = time.Now().UTC()
	return nil
}

// Resolve marks the intervention as resolved
func (i *Intervention) Resolve(validation ValidationResult) error {
	if i.State != InterventionValidation {
		return ErrInvalidInterventionState
	}
	if !validation.Valid {
		return ErrCannotResolveIntervention
	}
	now := time.Now().UTC()
	i.State = InterventionResolved
	i.Validation = &validation
	i.ResolvedAt = &now
	i.UpdatedAt = now
	return nil
}

// Fail marks the intervention as failed
func (i *Intervention) Fail(reason string) error {
	if i.State != InterventionValidation {
		return ErrInvalidInterventionState
	}
	i.State = InterventionFailed
	if i.Reason == "" {
		i.Reason = reason
	} else {
		i.Reason += "; " + reason
	}
	i.UpdatedAt = time.Now().UTC()
	return nil
}

// Close marks the intervention as closed (user dismissed)
func (i *Intervention) Close() error {
	now := time.Now().UTC()
	i.State = InterventionClosed
	i.ClosedAt = &now
	i.UpdatedAt = now
	return nil
}

// IsActive returns true if the intervention is still being worked on
func (i *Intervention) IsActive() bool {
	switch i.State {
	case InterventionResolved, InterventionFailed, InterventionClosed:
		return false
	default:
		return true
	}
}

// CanTransitionTo checks if a state transition is valid
func (i *Intervention) CanTransitionTo(newState string) bool {
	transitions := map[string][]string{
		InterventionObservation:  {InterventionDiagnosis, InterventionFailed},
		InterventionDiagnosis:    {InterventionProposal, InterventionFailed},
		InterventionProposal:     {InterventionUserFeedback, InterventionClosed},
		InterventionUserFeedback: {InterventionPatchCompile, InterventionProposal, InterventionClosed},
		InterventionPatchCompile: {InterventionValidation, InterventionFailed},
		InterventionValidation:   {InterventionResolved, InterventionFailed},
		InterventionResolved:     {InterventionClosed},
		InterventionFailed:       {InterventionDiagnosis, InterventionClosed},
		InterventionClosed:       {},
	}
	allowed, ok := transitions[i.State]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == newState {
			return true
		}
	}
	return false
}

func averageConfidence(proposals []Proposal) float64 {
	if len(proposals) == 0 {
		return 0.0
	}
	var total float64
	for _, p := range proposals {
		total += confidenceFromFields(p.Fields)
	}
	return total / float64(len(proposals))
}

func confidenceFromFields(fields []Field) float64 {
	if len(fields) == 0 {
		return 0.5
	}
	scores := map[Provenance]float64{
		ProvenanceProvided:  1.0,
		ProvenanceDerived:   0.8,
		ProvenanceInferred:  0.6,
		ProvenanceDefaulted: 0.4,
	}
	var total float64
	for _, f := range fields {
		if score, ok := scores[f.Provenance]; ok {
			total += score
		} else {
			total += 0.5
		}
	}
	return total / float64(len(fields))
}

func extractRequiresConfirmation(proposals []Proposal) []string {
	var requirements []string
	for _, p := range proposals {
		for _, hint := range p.ValidationHints {
			if strings.Contains(strings.ToLower(hint), "confirm") ||
				strings.Contains(strings.ToLower(hint), "review") ||
				strings.Contains(strings.ToLower(hint), "approve") {
				requirements = append(requirements, hint)
			}
		}
	}
	return requirements
}

func newInterventionID() (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "intv-" + hex.EncodeToString(bytes), nil
}

// ValidState checks if a state is valid
func ValidState(state string) bool {
	switch state {
	case InterventionObservation, InterventionDiagnosis, InterventionProposal,
		InterventionUserFeedback, InterventionPatchCompile, InterventionValidation,
		InterventionResolved, InterventionFailed, InterventionClosed:
		return true
	default:
		return false
	}
}

// ValidType checks if a type is valid
func ValidType(t string) bool {
	switch t {
	case TypePreflightError, TypeMeshFailure, TypeSolverFailure,
		TypeConvergenceAnomaly, TypeRemoteError:
		return true
	default:
		return false
	}
}
