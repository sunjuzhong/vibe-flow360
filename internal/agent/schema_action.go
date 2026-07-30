package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

const ActionVersion = "v1"

type Provenance string

const (
	ProvenanceProvided  Provenance = "provided"
	ProvenanceDerived   Provenance = "derived"
	ProvenanceInferred  Provenance = "inferred"
	ProvenanceDefaulted Provenance = "defaulted"
)

type ActionKind string

const (
	ActionCreatePlan          ActionKind = "create-plan"
	ActionRequestMissingInput ActionKind = "request-missing-input"
)

type Action struct {
	Version     string     `json:"version"`
	Kind        ActionKind `json:"kind"`
	Message     string     `json:"message"`
	Proposals   []Proposal `json:"proposals,omitempty"`
	Questions   []Question `json:"questions,omitempty"`
	Warnings    []string   `json:"warnings,omitempty"`
	Assumptions []string   `json:"assumptions,omitempty"`
}

type Proposal struct {
	ID              string          `json:"id"`
	ProjectID       string          `json:"project_id,omitempty"`
	ProjectName     string          `json:"project_name,omitempty"`
	SourceID        string          `json:"source_id,omitempty"`
	SourceType      string          `json:"action"`
	SourceName      string          `json:"source_name,omitempty"`
	Target          string          `json:"target"`
	Name            string          `json:"name"`
	Intent          string          `json:"intent"`
	Patch           json.RawMessage `json:"patch"`
	BranchPreview   string          `json:"branch_preview"`
	Fields          []Field         `json:"fields"`
	ValidationHints []string        `json:"validation_hints,omitempty"`
}

type Field struct {
	Key         string     `json:"key"`
	Value       any        `json:"value"`
	Provenance  Provenance `json:"provenance"`
	Description string     `json:"description,omitempty"`
}

type Question struct {
	Field   string `json:"field"`
	Message string `json:"message"`
	Urgency string `json:"urgency"`
	Reason  string `json:"reason,omitempty"`
}

var (
	ErrUnknownAction      = errors.New("schema: unknown action kind")
	ErrInvalidVersion     = errors.New("schema: unsupported action version")
	ErrMissingMessage     = errors.New("schema: message is required")
	ErrMissingFields      = errors.New("schema: proposal missing required fields")
	ErrInvalidProvenance  = errors.New("schema: invalid provenance")
	ErrInvalidJSON        = errors.New("schema: action is not valid JSON")
	ErrIncompatibleSource = errors.New("schema: source type is incompatible with target")
	ErrInvalidPatch       = errors.New("schema: patch must be valid JSON")
	ErrMissingProposals   = errors.New("schema: create-plan kind requires at least one proposal")
	ErrMissingQuestions   = errors.New("schema: request-missing-input kind requires at least one question")
	ErrAmbiguousAction    = errors.New("schema: proposals and questions are mutually exclusive")
	ErrInvalidQuestion    = errors.New("schema: question missing required fields")
	ErrInvalidUrgency     = errors.New("schema: invalid question urgency")
	ErrDangerousPatch     = errors.New("schema: patch contains potentially dangerous operations")
)

var validKinds = map[ActionKind]struct{}{
	ActionCreatePlan:          {},
	ActionRequestMissingInput: {},
}

var validTargets = map[string]map[string]struct{}{
	"Geometry":    {"surface-mesh": {}, "volume-mesh": {}, "case": {}},
	"SurfaceMesh": {"volume-mesh": {}, "case": {}},
	"VolumeMesh":  {"case": {}},
	"Case":        {"case": {}},
}

var validUrgencies = map[string]struct{}{
	"required":    {},
	"recommended": {},
	"optional":    {},
}

func Parse(raw string) (Action, error) {
	var action Action
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return action, ErrInvalidJSON
	}
	if err := json.Unmarshal([]byte(trimmed), &action); err != nil {
		return action, fmt.Errorf("%w: %v", ErrInvalidJSON, err)
	}
	for _, proposal := range action.Proposals {
		if len(proposal.Patch) > 0 && !json.Valid(proposal.Patch) {
			return action, fmt.Errorf("%w: proposal %s patch", ErrInvalidJSON, proposal.ID)
		}
	}
	if action.Version == "" {
		action.Version = ActionVersion
	}
	if action.Version != ActionVersion {
		return action, fmt.Errorf("%w: got %q", ErrInvalidVersion, action.Version)
	}
	if action.Kind == "" {
		return action, ErrUnknownAction
	}
	if _, ok := validKinds[action.Kind]; !ok {
		return action, fmt.Errorf("%w: %q", ErrUnknownAction, action.Kind)
	}
	if strings.TrimSpace(action.Message) == "" {
		return action, ErrMissingMessage
	}

	if len(action.Proposals) > 0 && len(action.Questions) > 0 {
		return action, ErrAmbiguousAction
	}

	switch action.Kind {
	case ActionCreatePlan:
		if len(action.Proposals) == 0 {
			return action, ErrMissingProposals
		}
		for _, proposal := range action.Proposals {
			if err := validateProposal(proposal); err != nil {
				return action, err
			}
		}
	case ActionRequestMissingInput:
		if len(action.Questions) == 0 {
			return action, ErrMissingQuestions
		}
		for _, question := range action.Questions {
			if err := validateQuestion(question); err != nil {
				return action, err
			}
		}
	}

	return action, nil
}

func validateQuestion(q Question) error {
	if strings.TrimSpace(q.Field) == "" || strings.TrimSpace(q.Message) == "" {
		return ErrInvalidQuestion
	}
	if q.Urgency != "" {
		if _, ok := validUrgencies[strings.ToLower(q.Urgency)]; !ok {
			return fmt.Errorf("%w: %q", ErrInvalidUrgency, q.Urgency)
		}
	}
	return nil
}

func ValidateWithContext(action Action, contextValidation func(Action) error) error {
	baseErr := validateActionSelfConsistency(action)
	if baseErr != nil {
		return baseErr
	}
	if contextValidation != nil {
		return contextValidation(action)
	}
	return nil
}

func validateActionSelfConsistency(action Action) error {
	if action.Kind == ActionCreatePlan {
		if len(action.Proposals) == 0 {
			return ErrMissingProposals
		}
		for _, p := range action.Proposals {
			if err := validateProposal(p); err != nil {
				return err
			}
		}
	}
	if action.Kind == ActionRequestMissingInput {
		if len(action.Questions) == 0 {
			return ErrMissingQuestions
		}
		for _, q := range action.Questions {
			if err := validateQuestion(q); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateProposal(p Proposal) error {
	if strings.TrimSpace(p.SourceType) == "" || strings.TrimSpace(p.Target) == "" || strings.TrimSpace(p.Name) == "" {
		return ErrMissingFields
	}
	if allowed, ok := validTargets[p.SourceType]; ok {
		if _, okTarget := allowed[p.Target]; !okTarget {
			return fmt.Errorf("%w: %s -> %s", ErrIncompatibleSource, p.SourceType, p.Target)
		}
	}
	for _, field := range p.Fields {
		if !validProvenance(field.Provenance) {
			return fmt.Errorf("%w: %q", ErrInvalidProvenance, field.Provenance)
		}
	}
	if len(p.Patch) > 0 && !json.Valid(p.Patch) {
		return fmt.Errorf("%w: proposal %s", ErrInvalidPatch, p.ID)
	}
	return nil
}

func validProvenance(p Provenance) bool {
	switch p {
	case ProvenanceProvided, ProvenanceDerived, ProvenanceInferred, ProvenanceDefaulted:
		return true
	}
	return false
}

func (a Action) Marshal() ([]byte, error) {
	return json.MarshalIndent(a, "", "  ")
}

func NewProposal(id, projectID, projectName, sourceID, sourceType, sourceName, target, name, intent, branch string, patch json.RawMessage, fields ...Field) Proposal {
	return Proposal{
		ID:            id,
		ProjectID:     projectID,
		ProjectName:   projectName,
		SourceID:      sourceID,
		SourceType:    sourceType,
		SourceName:    sourceName,
		Target:        target,
		Name:          name,
		Intent:        intent,
		Patch:         patch,
		BranchPreview: branch,
		Fields:        fields,
	}
}

func (p Proposal) ToPlan() plans.Plan {
	return plans.Plan{
		ID:         p.ID,
		SourceID:   p.SourceID,
		SourceType: p.SourceType,
		SourceName: p.SourceName,
		ProjectID:  p.ProjectID,
		Target:     p.Target,
		Name:       p.Name,
		Intent:     p.Intent,
		Patch:      p.Patch,
	}
}
