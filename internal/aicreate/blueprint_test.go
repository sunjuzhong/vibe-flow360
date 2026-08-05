package aicreate

import (
	"context"
	"strings"
	"testing"
)

type staticCompleter string

func (s staticCompleter) Complete(context.Context, string, string, string) (string, error) {
	return string(s), nil
}

func TestGeometrySystemPromptFollowsUserLanguage(t *testing.T) {
	for _, expected := range []string{"project_name: concise name in the user's language", "summary: concise engineering summary in the user's language", "assumptions: string array in the user's language"} {
		if !strings.Contains(geometrySystemPrompt, expected) {
			t.Fatalf("geometry prompt is missing %q", expected)
		}
	}
	if strings.Contains(geometrySystemPrompt, "concise English") || strings.Contains(geometrySystemPrompt, "English string array") {
		t.Fatalf("geometry prompt still forces English: %s", geometrySystemPrompt)
	}
}

type recordingCompleter struct {
	raw        string
	userPrompt string
}

type sequenceCompleter struct {
	responses []string
	calls     int
}

func (s *sequenceCompleter) Complete(context.Context, string, string, string) (string, error) {
	index := s.calls
	s.calls++
	if index >= len(s.responses) {
		index = len(s.responses) - 1
	}
	return s.responses[index], nil
}

func (r *recordingCompleter) Complete(_ context.Context, _ string, userPrompt string, _ string) (string, error) {
	r.userPrompt = userPrompt
	return r.raw, nil
}

func TestDesignUsesAgentAuthoredGeometryInsteadOfTemplate(t *testing.T) {
	raw := `{
  "version":"v1","decision":"generate","project_name":"Cooling Enclosure","summary":"External flow around a vented enclosure.",
  "geometry":{"name":"cooling-enclosure","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[
    {"id":"outer","op":"box","params":{"length":2.0,"width":1.0,"height":0.5}},
    {"id":"duct","op":"cylinder","params":{"radius":0.1,"height":2.0,"axis":"x"}},
    {"id":"result","op":"cut","params":{"left":"outer","right":"duct"}}
  ],"result":"result"},
  "simulation":{"velocity_m_s":12.0,"alpha_deg":0,"surface_edge_length_m":0.02,"first_layer_thickness_m":0.00002,"max_steps":8000},
  "assumptions":["Dimensions are interpreted in metres."],"questions":[]
}`
	blueprint, err := Design(context.Background(), staticCompleter(raw), "Create flow around a vented cooling enclosure")
	if err != nil {
		t.Fatal(err)
	}
	if blueprint.Geometry.Name != "cooling-enclosure" || len(blueprint.Geometry.Operations) != 3 {
		t.Fatalf("agent geometry was not preserved: %#v", blueprint.Geometry)
	}
	if blueprint.Geometry.Operations[0].Op != "box" || blueprint.Geometry.Operations[2].Op != "cut" {
		t.Fatalf("expected agent-selected parametric operations: %#v", blueprint.Geometry.Operations)
	}
	if blueprint.Geometry.Validated {
		t.Fatal("geometry must not be marked validated before kernel execution")
	}
}

func TestDesignReturnsAgentQuestionsForUnsupportedShape(t *testing.T) {
	raw := `{"version":"v1","decision":"request-input","project_name":"Wing","summary":"","geometry":{"name":"","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[],"result":""},"simulation":{},"assumptions":[],"questions":["Please attach the airfoil coordinates or an exact CAD model."]}`
	_, err := Design(context.Background(), staticCompleter(raw), "simulate my proprietary wing")
	missing, ok := err.(*MissingInputError)
	if !ok || len(missing.Questions) != 1 || !strings.Contains(missing.Questions[0], "airfoil") {
		t.Fatalf("expected focused missing-input result, got %T: %v", err, err)
	}
}

func TestDesignReturnsStructuredClarificationFields(t *testing.T) {
	raw := `{"version":"v1","decision":"request-input","project_name":"Cylinder Flow","summary":"","geometry":{"name":"","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[],"result":""},"simulation":{},"assumptions":[],"questions":[{"id":"diameter_m","label":"圆柱直径","description":"用于定义几何和雷诺数","type":"number","required":true,"unit":"m","min":0.001,"max":100},{"id":"domain_model","label":"计算域类型","type":"select","required":true,"options":[{"value":"periodic","label":"薄周期域"},{"value":"finite","label":"有限跨度"}]}]}`
	_, err := Design(context.Background(), staticCompleter(raw), "创建圆柱绕流")
	missing, ok := err.(*MissingInputError)
	if !ok {
		t.Fatalf("expected missing-input result, got %T: %v", err, err)
	}
	if len(missing.Fields) != 2 || missing.Fields[0].Type != "number" || missing.Fields[0].Unit != "m" {
		t.Fatalf("structured fields were not preserved: %#v", missing.Fields)
	}
	if len(missing.Fields[1].Options) != 2 {
		t.Fatalf("select options were not preserved: %#v", missing.Fields[1])
	}
}

func TestDesignConversationIncludesAuthoritativePriorAnswers(t *testing.T) {
	model := &recordingCompleter{raw: `{
  "version":"v1","decision":"generate","project_name":"Answered Cylinder","summary":"Cylinder flow using clarified dimensions.",
  "geometry":{"name":"answered-cylinder","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[{"id":"body","op":"cylinder","params":{"radius":0.25,"height":1,"axis":"z"}}],"result":"body"},
  "simulation":{"velocity_m_s":10,"alpha_deg":0,"surface_edge_length_m":0.02,"first_layer_thickness_m":0.00002,"max_steps":1000},"assumptions":[],"questions":[]
}`}
	history := []ClarificationRound{{
		Fields:  []ClarificationField{{ID: "diameter_m", Label: "Cylinder diameter", Type: "number", Required: true, Unit: "m"}},
		Answers: map[string]any{"diameter_m": 0.5},
	}}
	blueprint, err := DesignConversation(context.Background(), model, "Create cylinder flow", history)
	if err != nil {
		t.Fatal(err)
	}
	if blueprint.ProjectName != "Answered Cylinder" {
		t.Fatalf("unexpected blueprint: %#v", blueprint)
	}
	if !strings.Contains(model.userPrompt, "authoritative user answers") || !strings.Contains(model.userPrompt, `"diameter_m":0.5`) {
		t.Fatalf("clarification history missing from agent prompt: %s", model.userPrompt)
	}
}

func TestDesignNormalizesLocalizedCADIdentifiersAndReferences(t *testing.T) {
	raw := `{
  "version":"v1","decision":"generate","project_name":"三维圆柱绕流","summary":"三维圆柱绕流基础算例。",
  "geometry":{"name":"三维 圆柱绕流","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[
    {"id":"圆柱 主体","op":"Cylinder","params":{"radius":0.5,"height":1,"axis":"z"}},
    {"id":"移动 圆柱","op":"translate","params":{"source":"圆柱 主体","vector":[0,0,0]}}
  ],"results":[{"source":"移动 圆柱","name":"最终 实体","faces":[{"name":"圆柱 壁面","selector":"%cylinder"}]}]},
  "simulation":{"velocity_m_s":10,"alpha_deg":0,"surface_edge_length_m":0.02,"first_layer_thickness_m":0.00002,"max_steps":1000},"assumptions":[],"questions":[]
}`
	blueprint, err := Design(context.Background(), staticCompleter(raw), "创建三维圆柱绕流")
	if err != nil {
		t.Fatal(err)
	}
	if blueprint.Geometry.Name != "agent-geometry" || blueprint.Geometry.Operations[0].ID != "operation-1" {
		t.Fatalf("localized identifiers were not normalized: %#v", blueprint.Geometry)
	}
	if source := blueprint.Geometry.Operations[1].Params["source"]; source != blueprint.Geometry.Operations[0].ID {
		t.Fatalf("operation reference was not updated: %#v", blueprint.Geometry.Operations)
	}
	if blueprint.Geometry.Results[0].Source != blueprint.Geometry.Operations[1].ID || blueprint.Geometry.Results[0].Faces[0].Selector != "%CYLINDER" {
		t.Fatalf("result topology was not normalized consistently: %#v", blueprint.Geometry.Results)
	}
}

func TestDesignAutomaticallyRetriesInvalidCADPlan(t *testing.T) {
	invalid := `{"version":"v1","decision":"generate","project_name":"Cylinder","summary":"Cylinder flow.","geometry":{"name":"cylinder","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[{"id":"body","op":"unsupported-shape","params":{}}],"result":"body"},"simulation":{"velocity_m_s":10,"alpha_deg":0,"surface_edge_length_m":0.02,"first_layer_thickness_m":0.00002,"max_steps":1000},"assumptions":[],"questions":[]}`
	corrected := `{"version":"v1","decision":"generate","project_name":"Cylinder","summary":"Cylinder flow.","geometry":{"name":"cylinder","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[{"id":"body","op":"cylinder","params":{"radius":0.5,"height":1,"axis":"z"}}],"result":"body"},"simulation":{"velocity_m_s":10,"alpha_deg":0,"surface_edge_length_m":0.02,"first_layer_thickness_m":0.00002,"max_steps":1000},"assumptions":[],"questions":[]}`
	model := &sequenceCompleter{responses: []string{invalid, corrected}}
	blueprint, err := Design(context.Background(), model, "Create cylinder flow")
	if err != nil {
		t.Fatal(err)
	}
	if model.calls != 2 || blueprint.Geometry.Operations[0].Op != "cylinder" {
		t.Fatalf("expected one automatic repair attempt, got %d calls and %#v", model.calls, blueprint.Geometry)
	}
}

func TestDesignRejectsForwardReferencesAndUnsupportedCode(t *testing.T) {
	raw := `{"version":"v1","decision":"generate","project_name":"Unsafe","summary":"bad","geometry":{"name":"unsafe","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[{"id":"x","op":"python","params":{"source":"import os"}}],"result":"x"},"simulation":{"velocity_m_s":1,"alpha_deg":0,"surface_edge_length_m":0.1,"first_layer_thickness_m":0.001,"max_steps":10},"assumptions":[],"questions":[]}`
	if _, err := Design(context.Background(), staticCompleter(raw), "anything"); err == nil || !strings.Contains(err.Error(), "unsupported operation") {
		t.Fatalf("unsafe operation was not rejected: %v", err)
	}
}

func TestDesignAcceptsNamedMultiBodyLoftAndSweep(t *testing.T) {
	raw := `{
  "version":"v1","decision":"generate","project_name":"Named Assembly","summary":"Two exact named flow bodies.",
  "geometry":{"name":"named-assembly","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[
    {"id":"wing","op":"loft","params":{"axis":"z","sections":[
      {"offset":0,"profile":[[-1,-0.1],[1,-0.1],[1,0.1],[-1,0.1]]},
      {"offset":2,"profile":[[-0.5,-0.05],[0.5,-0.05],[0.5,0.05],[-0.5,0.05]]}
    ]}},
    {"id":"pipe","op":"sweep","params":{"profile_plane":"YZ","profile":[[-0.1,-0.1],[0.1,-0.1],[0.1,0.1],[-0.1,0.1]],"path":[[0,0,0],[1,0,0],[2,1,0]]}}
  ],"results":[
    {"source":"wing","name":"wing-body","faces":[{"name":"tip","selector":">Z"}]},
    {"source":"pipe","name":"flow-pipe","faces":[{"name":"wall","selector":"%PLANE"}]}
  ]},
  "simulation":{"velocity_m_s":10,"alpha_deg":0,"surface_edge_length_m":0.02,"first_layer_thickness_m":0.00002,"max_steps":1000},
  "assumptions":[],"questions":[]
}`
	blueprint, err := Design(context.Background(), staticCompleter(raw), "Create two named bodies")
	if err != nil {
		t.Fatal(err)
	}
	if len(blueprint.Geometry.Results) != 2 || blueprint.Geometry.Results[0].Faces[0].Name != "tip" {
		t.Fatalf("named topology was not preserved: %#v", blueprint.Geometry.Results)
	}
}

func TestDesignRejectsUnknownFaceSelector(t *testing.T) {
	raw := `{"version":"v1","decision":"generate","project_name":"Bad Selector","summary":"bad","geometry":{"name":"bad-selector","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[{"id":"body","op":"box","params":{"length":1,"width":1,"height":1}}],"results":[{"source":"body","name":"body","faces":[{"name":"wall","selector":"python()"}]}]},"simulation":{"velocity_m_s":1,"alpha_deg":0,"surface_edge_length_m":0.1,"first_layer_thickness_m":0.001,"max_steps":10},"assumptions":[],"questions":[]}`
	if _, err := Design(context.Background(), staticCompleter(raw), "anything"); err == nil || !strings.Contains(err.Error(), "unsupported face selector") {
		t.Fatalf("unsafe selector was not rejected: %v", err)
	}
}
