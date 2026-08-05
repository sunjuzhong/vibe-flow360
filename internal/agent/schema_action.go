package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
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

// UnmarshalJSON keeps the wire contract canonical (fields is an array), while
// narrowly recovering the two object shapes commonly emitted by LLMs. Any
// other shape remains an error so malformed actions still enter repair.
func (p *Proposal) UnmarshalJSON(data []byte) error {
	type proposalAlias Proposal
	var wire struct {
		proposalAlias
		Fields json.RawMessage `json:"fields"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	*p = Proposal(wire.proposalAlias)
	if len(wire.Fields) == 0 || string(wire.Fields) == "null" {
		return nil
	}

	if err := json.Unmarshal(wire.Fields, &p.Fields); err == nil {
		return nil
	}

	var object map[string]json.RawMessage
	if err := json.Unmarshal(wire.Fields, &object); err != nil {
		return fmt.Errorf("fields must be an array of field objects: %w", err)
	}
	if _, singleton := object["key"]; singleton {
		var field Field
		if err := json.Unmarshal(wire.Fields, &field); err != nil {
			return fmt.Errorf("invalid field object: %w", err)
		}
		p.Fields = []Field{field}
		return nil
	}

	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	p.Fields = make([]Field, 0, len(keys))
	for _, key := range keys {
		var field Field
		if err := json.Unmarshal(object[key], &field); err != nil {
			return fmt.Errorf("field %q must be an object: %w", key, err)
		}
		if strings.TrimSpace(field.Key) == "" {
			field.Key = key
		}
		p.Fields = append(p.Fields, field)
	}
	return nil
}

type Field struct {
	Key         string     `json:"key"`
	Value       any        `json:"value"`
	Provenance  Provenance `json:"provenance"`
	Description string     `json:"description,omitempty"`
}

type Question struct {
	Field          string           `json:"field"`
	Message        string           `json:"message"`
	Urgency        string           `json:"urgency"`
	Reason         string           `json:"reason,omitempty"`
	Type           string           `json:"type,omitempty"`
	Unit           string           `json:"unit,omitempty"`
	Options        []QuestionOption `json:"options,omitempty"`
	Default        any              `json:"default,omitempty"`
	Recommendation string           `json:"recommendation,omitempty"`
	Min            *float64         `json:"min,omitempty"`
	Max            *float64         `json:"max,omitempty"`
	Placeholder    string           `json:"placeholder,omitempty"`
}

type QuestionOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
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

var validQuestionTypes = map[string]struct{}{
	"text": {}, "number": {}, "select": {}, "boolean": {},
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
		if len(action.Questions) > 6 {
			return action, fmt.Errorf("%w: at most six questions are allowed", ErrInvalidQuestion)
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
	questionType := strings.ToLower(strings.TrimSpace(q.Type))
	if questionType != "" {
		if _, ok := validQuestionTypes[questionType]; !ok {
			return fmt.Errorf("%w: unsupported question type %q", ErrInvalidQuestion, q.Type)
		}
		if questionType == "select" && len(q.Options) == 0 {
			return fmt.Errorf("%w: select question requires options", ErrInvalidQuestion)
		}
	}
	if q.Min != nil && q.Max != nil && *q.Min > *q.Max {
		return fmt.Errorf("%w: minimum exceeds maximum", ErrInvalidQuestion)
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
		if len(action.Questions) > 6 {
			return fmt.Errorf("%w: at most six questions are allowed", ErrInvalidQuestion)
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
	if strings.TrimSpace(p.ID) == "" || strings.TrimSpace(p.SourceType) == "" || strings.TrimSpace(p.Target) == "" || strings.TrimSpace(p.Name) == "" || strings.TrimSpace(p.Intent) == "" {
		return ErrMissingFields
	}
	if allowed, ok := validTargets[p.SourceType]; ok {
		if _, okTarget := allowed[p.Target]; !okTarget {
			return fmt.Errorf("%w: %s -> %s", ErrIncompatibleSource, p.SourceType, p.Target)
		}
	}
	for _, field := range p.Fields {
		if strings.TrimSpace(field.Key) == "" {
			return ErrMissingFields
		}
		if !validProvenance(field.Provenance) {
			return fmt.Errorf("%w: %q", ErrInvalidProvenance, field.Provenance)
		}
	}
	if len(p.Patch) == 0 || !json.Valid(p.Patch) {
		return fmt.Errorf("%w: proposal %s", ErrInvalidPatch, p.ID)
	}
	var patchObject map[string]json.RawMessage
	if err := json.Unmarshal(p.Patch, &patchObject); err != nil || patchObject == nil {
		return fmt.Errorf("%w: proposal %s must be a JSON object", ErrInvalidPatch, p.ID)
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
	evidence := make([]plans.Evidence, 0, len(p.Fields))
	for _, field := range p.Fields {
		evidence = append(evidence, plans.Evidence{
			Key: field.Key, Value: field.Value, Provenance: string(field.Provenance), Description: field.Description,
		})
	}
	return plans.Plan{
		ID:              p.ID,
		SourceID:        p.SourceID,
		SourceType:      p.SourceType,
		SourceName:      p.SourceName,
		ProjectID:       p.ProjectID,
		Target:          p.Target,
		Name:            p.Name,
		Intent:          p.Intent,
		Patch:           p.Patch,
		Evidence:        evidence,
		ValidationHints: append([]string(nil), p.ValidationHints...),
	}
}
