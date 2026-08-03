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

func TestDesignRejectsForwardReferencesAndUnsupportedCode(t *testing.T) {
	raw := `{"version":"v1","decision":"generate","project_name":"Unsafe","summary":"bad","geometry":{"name":"unsafe","unit":"m","representation":"analytic-brep","format":"step","generator":"cadquery-dsl-v1","operations":[{"id":"x","op":"python","params":{"source":"import os"}}],"result":"x"},"simulation":{"velocity_m_s":1,"alpha_deg":0,"surface_edge_length_m":0.1,"first_layer_thickness_m":0.001,"max_steps":10},"assumptions":[],"questions":[]}`
	if _, err := Design(context.Background(), staticCompleter(raw), "anything"); err == nil || !strings.Contains(err.Error(), "unsupported operation") {
		t.Fatalf("unsafe operation was not rejected: %v", err)
	}
}
