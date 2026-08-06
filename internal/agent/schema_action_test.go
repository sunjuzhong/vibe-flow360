package agent

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestParseAcceptsCreatePlanAction(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "create-plan",
  "message": "Plan a case variation at AoA 5 deg",
  "proposals": [
    {
      "id": "p1",
      "project_id": "prj-1",
      "source_id": "vm-1",
      "action": "VolumeMesh",
      "target": "case",
      "name": "AoA 5 deg",
      "intent": "Lift comparison",
      "patch": {"operating_condition":{"alpha":{"value":5}}},
      "branch_preview": "aoa-5-deg",
      "fields": [
        {"key": "alpha", "value": 5, "provenance": "provided"}
      ]
    }
  ]
}`
	action, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if action.Kind != ActionCreatePlan {
		t.Fatalf("expected create-plan, got %q", action.Kind)
	}
	if len(action.Proposals) != 1 {
		t.Fatalf("expected 1 proposal, got %d", len(action.Proposals))
	}
	if action.Proposals[0].Fields[0].Provenance != ProvenanceProvided {
		t.Fatalf("expected provided provenance, got %q", action.Proposals[0].Fields[0].Provenance)
	}
	if action.Proposals[0].ProjectID != "prj-1" {
		t.Fatalf("expected project id, got %q", action.Proposals[0].ProjectID)
	}
}

func TestParseNormalizesSingletonObjectField(t *testing.T) {
	raw := `{
  "version":"v1","kind":"create-plan","message":"Plan",
  "proposals":[{
    "id":"p1","action":"Case","target":"case","name":"test","intent":"Run case",
    "patch":{},"fields":{"key":"operating_condition.alpha","value":3,"provenance":"provided"}
  }]
}`
	action, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	fields := action.Proposals[0].Fields
	if len(fields) != 1 || fields[0].Key != "operating_condition.alpha" {
		t.Fatalf("expected singleton field normalization, got %#v", fields)
	}
}

func TestParseNormalizesPathKeyedFieldObject(t *testing.T) {
	raw := `{
  "version":"v1","kind":"create-plan","message":"Plan",
  "proposals":[{
    "id":"p1","action":"Case","target":"case","name":"test","intent":"Run case",
    "patch":{},"fields":{
      "time_stepping.max_steps":{"value":1000,"provenance":"inferred"},
      "operating_condition.alpha":{"value":3,"provenance":"provided"}
    }
  }]
}`
	action, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	fields := action.Proposals[0].Fields
	if len(fields) != 2 {
		t.Fatalf("expected two normalized fields, got %#v", fields)
	}
	if fields[0].Key != "operating_condition.alpha" || fields[1].Key != "time_stepping.max_steps" {
		t.Fatalf("expected deterministic path keys, got %#v", fields)
	}
}

func TestParseRejectsPrimitiveFieldMap(t *testing.T) {
	raw := `{
  "version":"v1","kind":"create-plan","message":"Plan",
  "proposals":[{
    "id":"p1","action":"Case","target":"case","name":"test","intent":"Run case",
    "patch":{},"fields":{"operating_condition.alpha":3}
  }]
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrInvalidJSON) {
		t.Fatalf("expected malformed field map to enter repair, got %v", err)
	}
}

func TestParseRejectsNonObjectPatch(t *testing.T) {
	raw := `{
  "version":"v1","kind":"create-plan","message":"Plan",
  "proposals":[{
    "id":"p1","action":"Case","target":"case","name":"test","intent":"Run case",
    "patch":[],"fields":[]
  }]
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrInvalidPatch) {
		t.Fatalf("expected ErrInvalidPatch, got %v", err)
	}
}

func TestParseDefaultsVersion(t *testing.T) {
	raw := `{
  "kind": "request-missing-input",
  "message": "Need operating conditions",
  "questions": [
    {"field": "velocity", "message": "What is the velocity?", "urgency": "required"}
  ]
}`
	action, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if action.Version != ActionVersion {
		t.Fatalf("expected default version v1, got %q", action.Version)
	}
}

func TestProposalToPlanPreservesEvidence(t *testing.T) {
	proposal := Proposal{
		ID: "proposal-1", ProjectID: "prj-1", SourceID: "geo-1", SourceType: "Geometry",
		Target: "surface-mesh", Name: "review", Intent: "Review semantics.", Patch: json.RawMessage(`{}`),
		Fields:          []Field{{Key: "surface_role", Value: "wall", Provenance: ProvenanceProvided, Description: "User assignment"}},
		ValidationHints: []string{"Run preflight"},
	}
	plan := proposal.ToPlan()
	if len(plan.Evidence) != 1 || plan.Evidence[0].Provenance != "provided" {
		t.Fatalf("expected proposal evidence on plan, got %#v", plan.Evidence)
	}
	if len(plan.ValidationHints) != 1 || plan.ValidationHints[0] != "Run preflight" {
		t.Fatalf("expected validation hints, got %#v", plan.ValidationHints)
	}
}

func TestParseRejectsUnknownKind(t *testing.T) {
	_, err := Parse(`{"version":"v1","kind":"unknown","message":"foo"}`)
	if !errors.Is(err, ErrUnknownAction) {
		t.Fatalf("expected ErrUnknownAction, got %v", err)
	}
}

func TestParseRejectsBadVersion(t *testing.T) {
	_, err := Parse(`{"version":"v9","kind":"create-plan","message":"foo"}`)
	if !errors.Is(err, ErrInvalidVersion) {
		t.Fatalf("expected ErrInvalidVersion, got %v", err)
	}
}

func TestParseRejectsMissingMessage(t *testing.T) {
	_, err := Parse(`{"version":"v1","kind":"create-plan","message":"   "}`)
	if !errors.Is(err, ErrMissingMessage) {
		t.Fatalf("expected ErrMissingMessage, got %v", err)
	}
}

func TestParseRejectsIncompatibleTarget(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "create-plan",
  "message": "Plan a surface mesh from a case",
  "proposals": [
    {
      "id": "p1",
      "action": "Case",
      "target": "surface-mesh",
      "name": "invalid",
      "intent": "Should fail",
      "patch": {},
      "fields": []
    }
  ]
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrIncompatibleSource) {
		t.Fatalf("expected ErrIncompatibleSource, got %v", err)
	}
	if !strings.Contains(err.Error(), "Case -> surface-mesh") {
		t.Fatalf("expected detail in error, got %v", err)
	}
}

func TestParseRejectsInvalidProvenance(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "create-plan",
  "message": "Test",
  "proposals": [
    {
      "id": "p1",
      "action": "Geometry",
      "target": "case",
      "name": "bad",
      "intent": "Test",
      "patch": {},
      "fields": [{"key": "a", "value": 1, "provenance": "magic"}]
    }
  ]
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrInvalidProvenance) {
		t.Fatalf("expected ErrInvalidProvenance, got %v", err)
	}
}

func TestParseRejectsInvalidPatch(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "create-plan",
  "message": "Bad patch",
  "proposals": [
    {
      "id": "p1",
      "action": "VolumeMesh",
      "target": "case",
      "name": "bad",
      "intent": "Test",
      "patch": [1,2,
      "fields": [{"key": "a", "value": 1, "provenance": "provided"}]
    }
  ]
}`
	_, err := Parse(raw)
	if err == nil {
		t.Fatal("expected patch validation error")
	}
}

func TestParseRejectsEmptyInput(t *testing.T) {
	_, err := Parse("")
	if !errors.Is(err, ErrInvalidJSON) {
		t.Fatalf("expected ErrInvalidJSON, got %v", err)
	}
}

func TestParseRequestMissingInputQuestions(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "request-missing-input",
  "message": "Need operating conditions",
  "warnings": ["No velocity provided"],
  "questions": [
    {"field": "velocity", "message": "What is the freestream velocity?", "urgency": "required"}
  ]
}`
	action, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if action.Kind != ActionRequestMissingInput {
		t.Fatalf("expected request-missing-input, got %q", action.Kind)
	}
	if len(action.Warnings) != 1 {
		t.Fatalf("expected 1 warning, got %d", len(action.Warnings))
	}
	if len(action.Questions) != 1 {
		t.Fatalf("expected 1 question, got %d", len(action.Questions))
	}
}

func TestParseAcceptsTypedClarificationQuestion(t *testing.T) {
	raw := `{
  "version":"v1",
  "kind":"request-missing-input",
  "message":"Choose the turbulence model",
  "questions":[{
    "field":"model.turbulence",
    "message":"Which turbulence model should be used?",
    "urgency":"required",
    "type":"select",
    "options":[{"value":"sa","label":"Spalart-Allmaras"},{"value":"sst","label":"k-omega SST"}],
    "default":"sa",
    "recommendation":"Stable baseline for this external-flow setup"
  }]
}`
	action, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	question := action.Questions[0]
	if question.Type != "select" || len(question.Options) != 2 || question.Default != "sa" || question.Recommendation == "" {
		t.Fatalf("typed question was not preserved: %#v", question)
	}
}

func TestParseRejectsDuplicateClarificationFields(t *testing.T) {
	raw := `{
  "version":"v1","kind":"request-missing-input","message":"Need details",
  "questions":[
    {"field":"SimulationParams","message":"Which stage failed?","urgency":"required","type":"text"},
    {"field":"SimulationParams","message":"Paste the logs","urgency":"required","type":"text"}
  ]
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrInvalidQuestion) || !strings.Contains(err.Error(), "duplicate question field") {
		t.Fatalf("expected duplicate clarification fields to enter repair, got %v", err)
	}
}

func TestParseRejectsSelectQuestionWithoutOptions(t *testing.T) {
	raw := `{
  "version":"v1",
  "kind":"request-missing-input",
  "message":"Choose a model",
  "questions":[{"field":"model","message":"Model?","urgency":"required","type":"select"}]
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrInvalidQuestion) {
		t.Fatalf("expected ErrInvalidQuestion, got %v", err)
	}
}

func TestParseAcceptsFieldWithoutProvenance(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "create-plan",
  "message": "Plan",
  "proposals": [
    {
      "id": "p1",
      "action": "VolumeMesh",
      "target": "case",
      "name": "test",
      "intent": "Test",
      "patch": {},
      "fields": [{"key": "a", "value": 1}]
    }
  ]
}`
	_, err := Parse(raw)
	if err == nil {
		t.Fatal("expected error when provenance missing")
	}
}

func TestParseRejectsAmbiguousAction(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "create-plan",
  "message": "Ambiguous",
  "proposals": [
    {
      "id": "p1",
      "action": "Case",
      "target": "case",
      "name": "test",
      "intent": "Test",
      "patch": {},
      "fields": [{"key": "a", "value": 1, "provenance": "provided"}]
    }
  ],
  "questions": [
    {"field": "vel", "message": "velocity?", "urgency": "required"}
  ]
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrAmbiguousAction) {
		t.Fatalf("expected ErrAmbiguousAction, got %v", err)
	}
}

func TestParseRejectsCreatePlanWithoutProposals(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "create-plan",
  "message": "No proposals"
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrMissingProposals) {
		t.Fatalf("expected ErrMissingProposals, got %v", err)
	}
}

func TestParseRejectsRequestMissingInputWithoutQuestions(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "request-missing-input",
  "message": "No questions"
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrMissingQuestions) {
		t.Fatalf("expected ErrMissingQuestions, got %v", err)
	}
}

func TestParseRejectsQuestionWithoutFieldOrMessage(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "request-missing-input",
  "message": "Bad question",
  "questions": [
    {"field": "", "message": "", "urgency": "required"}
  ]
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrInvalidQuestion) {
		t.Fatalf("expected ErrInvalidQuestion, got %v", err)
	}
}

func TestParseRejectsInvalidUrgency(t *testing.T) {
	raw := `{
  "version": "v1",
  "kind": "request-missing-input",
  "message": "Bad urgency",
  "questions": [
    {"field": "vel", "message": "velocity?", "urgency": "critical"}
  ]
}`
	_, err := Parse(raw)
	if !errors.Is(err, ErrInvalidUrgency) {
		t.Fatalf("expected ErrInvalidUrgency, got %v", err)
	}
}

func TestParseAcceptsValidUrgencyLevels(t *testing.T) {
	for _, urgency := range []string{"required", "recommended", "optional"} {
		raw := `{
  "version": "v1",
  "kind": "request-missing-input",
  "message": "Valid",
  "questions": [
    {"field": "vel", "message": "velocity?", "urgency": "` + urgency + `"}
  ]
}`
		_, err := Parse(raw)
		if err != nil {
			t.Errorf("urgency %q should be valid: %v", urgency, err)
		}
	}
}

func TestValidateWithContextPassesWithNilValidator(t *testing.T) {
	action := Action{
		Version: ActionVersion,
		Kind:    ActionCreatePlan,
		Message: "Test",
		Proposals: []Proposal{
			{ID: "p1", SourceType: "Case", Target: "case", Name: "test", Intent: "Test",
				Patch:  json.RawMessage(`{}`),
				Fields: []Field{{Key: "a", Value: 1, Provenance: ProvenanceProvided}}},
		},
	}
	err := ValidateWithContext(action, nil)
	if err != nil {
		t.Fatalf("expected no error with nil validator, got %v", err)
	}
}

func TestValidateWithContextCallsCustomValidator(t *testing.T) {
	action := Action{
		Version: ActionVersion,
		Kind:    ActionCreatePlan,
		Message: "Test",
		Proposals: []Proposal{
			{ID: "p1", SourceType: "Case", Target: "case", Name: "test", Intent: "Test",
				Patch:  json.RawMessage(`{}`),
				Fields: []Field{{Key: "a", Value: 1, Provenance: ProvenanceProvided}}},
		},
	}
	customErr := errors.New("custom validation failed")
	err := ValidateWithContext(action, func(a Action) error {
		return customErr
	})
	if !errors.Is(err, customErr) {
		t.Fatalf("expected custom error, got %v", err)
	}
}

func TestValidateWithContextFailsOnInvalidAction(t *testing.T) {
	action := Action{
		Version: ActionVersion,
		Kind:    ActionCreatePlan,
		Message: "Test",
	}
	err := ValidateWithContext(action, nil)
	if !errors.Is(err, ErrMissingProposals) {
		t.Fatalf("expected ErrMissingProposals, got %v", err)
	}
}

func TestMarshalRoundTrip(t *testing.T) {
	original := Action{
		Version: ActionVersion,
		Kind:    ActionCreatePlan,
		Message: "Plan",
		Proposals: []Proposal{
			{
				ID: "p1", SourceType: "Geometry", Target: "surface-mesh",
				Name: "test", Intent: "Test",
				Patch:  json.RawMessage(`{"foo":"bar"}`),
				Fields: []Field{{Key: "foo", Value: "bar", Provenance: ProvenanceDerived}},
			},
		},
	}
	data, err := original.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	round, err := Parse(string(data))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(round.Message, "Plan") {
		t.Fatalf("round trip lost message: %v", round)
	}
	if len(round.Proposals) != 1 {
		t.Fatalf("round trip lost proposals: %v", round)
	}
}
