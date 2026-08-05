package aicreate

import (
	"encoding/json"
	"strings"
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

func TestCompleteSimulationPatchMapsNamedBoundarySemantics(t *testing.T) {
	baseline := json.RawMessage(`{"models":[
		{"type":"Wall","entities":{"stored_entities":[{"name":"*"}]}},
		{"type":"Freestream","entities":{"stored_entities":[{"name":"farfield","private_attribute_entity_type_name":"GhostSphere"}]}},
		{"type":"Fluid"}
	],"private_attribute_asset_cache":{"project_entity_info":{
		"face_group_tag":"faceId",
		"global_bounding_box":[[-1,-1,0],[1,1,2]],
		"grouped_faces":[[
			{"name":"inlet","private_attribute_id":"inlet","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"outlet","private_attribute_id":"outlet","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"spanwise_periodic_max","private_attribute_id":"periodic-max","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"spanwise_periodic_min","private_attribute_id":"periodic-min","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"cylinder_wall","private_attribute_id":"wall","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"}
		]],
		"ghost_entities":[{"name":"symmetric","center":[0,0,0],"normal_axis":[0,0,1],"private_attribute_id":"symmetric","private_attribute_entity_type_name":"GhostCircularPlane"}]
	}}}`)
	patch, err := CompleteSimulationPatch(baseline, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	models := patch["models"].([]any)
	byType := map[string]map[string]any{}
	for _, raw := range models {
		model := raw.(map[string]any)
		byType[model["type"].(string)] = model
	}
	wallEntities := storedBoundaryEntities(byType["Wall"])
	if len(wallEntities) != 1 || wallEntities[0].(map[string]any)["name"] != "cylinder_wall" {
		t.Fatalf("semantic Wall mapping failed: %#v", wallEntities)
	}
	freestreamEntities := storedBoundaryEntities(byType["Freestream"])
	if len(freestreamEntities) != 3 {
		t.Fatalf("expected inherited farfield plus inlet/outlet, got %#v", freestreamEntities)
	}
	periodic := byType["Periodic"]
	pairs := periodic["surface_pairs"].(map[string]any)["items"].([]any)
	if len(pairs) != 1 || len(pairs[0].(map[string]any)["pair"].([]any)) != 2 {
		t.Fatalf("periodic pair was not generated: %#v", periodic)
	}
	symmetryEntities := storedBoundaryEntities(byType["SymmetryPlane"])
	if len(symmetryEntities) != 1 || symmetryEntities[0].(map[string]any)["name"] != "symmetric" {
		t.Fatalf("AutomatedFarfield symmetry mapping failed: %#v", symmetryEntities)
	}
}

func TestCompleteSimulationPatchRejectsInteriorSymmetricGhost(t *testing.T) {
	baseline := json.RawMessage(`{"models":[
		{"type":"Wall","entities":{"stored_entities":[{"name":"*"}]}},
		{"type":"Freestream","entities":{"stored_entities":[{"name":"farfield"}]}},
		{"type":"Fluid"}
	],"private_attribute_asset_cache":{"project_entity_info":{
		"face_group_tag":"faceId",
		"global_bounding_box":[[-27.5,-20,-4],[7.5,20,0]],
		"grouped_faces":[[
			{"name":"spanwise_periodic_min","private_attribute_id":"periodic-min","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"spanwise_periodic_max","private_attribute_id":"periodic-max","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"cylinder_wall","private_attribute_id":"wall","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"}
		]],
		"ghost_entities":[{"name":"symmetric","center":[0,0,0],"normal_axis":[0,1,0],"private_attribute_id":"symmetric","private_attribute_entity_type_name":"GhostCircularPlane"}]
	}}}`)
	patch, err := CompleteSimulationPatch(baseline, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range patch["models"].([]any) {
		model := raw.(map[string]any)
		if model["type"] == "SymmetryPlane" {
			t.Fatalf("interior AutomatedFarfield helper was assigned as a boundary: %#v", model)
		}
	}
}

func TestValidateImportedGeometryContractAcceptsCompleteNamedCoverage(t *testing.T) {
	geometry := Geometry{Results: []GeometryResult{{Name: "fluid", Faces: []FaceLabel{
		{Name: "inlet"}, {Name: "outlet"}, {Name: "cylinder_wall"},
	}}}}
	baseline := json.RawMessage(`{"simulation_params":{"private_attribute_asset_cache":{"project_entity_info":{
		"face_group_tag":"faceId","grouped_faces":[
			[{"name":"face-1","private_attribute_id":"face-1","private_attribute_tag_key":"faceId"},{"name":"face-2","private_attribute_id":"face-2","private_attribute_tag_key":"faceId"},{"name":"face-3","private_attribute_id":"face-3","private_attribute_tag_key":"faceId"}],
			[{"name":"inlet","private_attribute_tag_key":"builtinName","private_attribute_sub_components":["face-1"]},{"name":"outlet","private_attribute_tag_key":"builtinName","private_attribute_sub_components":["face-2"]},{"name":"cylinder_wall","private_attribute_tag_key":"builtinName","private_attribute_sub_components":["face-3"]}]
		]}}}}`)
	if err := ValidateImportedGeometryContract(baseline, geometry); err != nil {
		t.Fatal(err)
	}
}

func TestValidateImportedGeometryContractRejectsPartialCylinderWall(t *testing.T) {
	geometry := Geometry{Results: []GeometryResult{{Name: "fluid", Faces: []FaceLabel{
		{Name: "spanwise_periodic_min"}, {Name: "spanwise_periodic_max"}, {Name: "cylinder_wall"},
	}}}}
	baseline := json.RawMessage(`{"simulation_params":{"private_attribute_asset_cache":{"project_entity_info":{
		"face_group_tag":"faceId","grouped_faces":[
			[{"name":"face-1","private_attribute_id":"face-1","private_attribute_tag_key":"faceId"},{"name":"face-2","private_attribute_id":"face-2","private_attribute_tag_key":"faceId"},{"name":"face-3","private_attribute_id":"face-3","private_attribute_tag_key":"faceId"},{"name":"face-4","private_attribute_id":"face-4","private_attribute_tag_key":"faceId"}],
			[{"name":"spanwise_periodic_min","private_attribute_tag_key":"builtinName","private_attribute_sub_components":["face-1"]},{"name":"spanwise_periodic_max","private_attribute_tag_key":"builtinName","private_attribute_sub_components":["face-2"]},{"name":"cylinder_wall","private_attribute_tag_key":"builtinName","private_attribute_sub_components":["face-3"]}]
		]}}}}`)
	err := ValidateImportedGeometryContract(baseline, geometry)
	if err == nil || !strings.Contains(err.Error(), "unnamed concrete faces=1") {
		t.Fatalf("partial wall coverage was not rejected: %v", err)
	}
}
