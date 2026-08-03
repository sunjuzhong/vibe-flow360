package aicreate

import (
	"encoding/json"
	"testing"
)

func TestCompleteSimulationPatchAssignsConcreteGeometryFaces(t *testing.T) {
	baseline := json.RawMessage(`{"simulation_params":{"models":[{"type":"Wall","entities":{"stored_entities":[{"name":"*"}]}},{"type":"Freestream"},{"type":"Fluid"}],"private_attribute_asset_cache":{"project_entity_info":{"face_group_tag":"faceId","grouped_faces":[[{"name":"cylinder-side","private_attribute_id":"face-1","private_attribute_tag_key":"faceId","private_attribute_entity_type_name":"Surface"}],[{"name":"by-body","private_attribute_id":"body-1","private_attribute_tag_key":"groupByBodyId","private_attribute_entity_type_name":"Surface"}]]}}}}`)
	patch, err := CompleteSimulationPatch(baseline, map[string]any{"time_stepping": map[string]any{"max_steps": 10000}})
	if err != nil {
		t.Fatal(err)
	}
	models := patch["models"].([]any)
	wall := models[0].(map[string]any)
	entities := wall["entities"].(map[string]any)["stored_entities"].([]any)
	if len(entities) != 1 || entities[0].(map[string]any)["name"] != "cylinder-side" {
		t.Fatalf("unexpected Wall entities: %#v", entities)
	}
	if _, exists := wall["surfaces"]; exists {
		t.Fatal("legacy Wall surfaces alias should not remain")
	}
}

func TestCompleteSimulationPatchRejectsMissingGeometryFaces(t *testing.T) {
	baseline := json.RawMessage(`{"models":[{"type":"Wall"}],"private_attribute_asset_cache":{"project_entity_info":{"face_group_tag":"faceId","grouped_faces":[]}}}`)
	if _, err := CompleteSimulationPatch(baseline, map[string]any{}); err == nil {
		t.Fatal("expected missing Geometry faces to stop AI Create")
	}
}
