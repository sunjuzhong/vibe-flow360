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
		"grouped_faces":[[
			{"name":"inlet","private_attribute_id":"inlet","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"outlet","private_attribute_id":"outlet","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"spanwise_symmetry_max","private_attribute_id":"symmetry-max","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"spanwise_symmetry_min","private_attribute_id":"symmetry-min","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"cylinder_wall","private_attribute_id":"wall","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"}
		]],
		"ghost_entities":[{"name":"provider-helper","private_attribute_id":"provider-helper","private_attribute_entity_type_name":"GhostCircularPlane"}]
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
	symmetry := byType["SymmetryPlane"]
	symmetryEntities := storedBoundaryEntities(symmetry)
	if len(symmetryEntities) != 2 {
		t.Fatalf("explicit spanwise symmetry faces were not assigned: %#v", symmetry)
	}
	if _, exists := byType["Periodic"]; exists {
		t.Fatal("AI Create must not infer a periodic boundary before VolumeMesh conformity is established")
	}
}

func TestCompleteSimulationPatchDoesNotInterpretProviderGhostNames(t *testing.T) {
	baseline := json.RawMessage(`{"models":[
		{"type":"Wall","entities":{"stored_entities":[{"name":"*"}]}},
		{"type":"Freestream","entities":{"stored_entities":[{"name":"farfield"}]}},
		{"type":"Fluid"}
	],"private_attribute_asset_cache":{"project_entity_info":{
		"face_group_tag":"faceId",
		"grouped_faces":[[
			{"name":"inlet","private_attribute_id":"inlet","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"outlet","private_attribute_id":"outlet","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"},
			{"name":"cylinder_wall","private_attribute_id":"wall","private_attribute_tag_key":"builtinName","private_attribute_entity_type_name":"Surface"}
		]],
		"ghost_entities":[
			{"name":"arbitrary-provider-boundary","private_attribute_id":"arbitrary-provider-boundary","private_attribute_entity_type_name":"GhostCircularPlane"},
			{"name":"symmetric","private_attribute_id":"symmetric","private_attribute_entity_type_name":"GhostCircularPlane"}
		]
	}}}`)
	patch, err := CompleteSimulationPatch(baseline, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range patch["models"].([]any) {
		model := raw.(map[string]any)
		if model["type"] == "SymmetryPlane" {
			t.Fatalf("a provider ghost name was interpreted outside Flow360 schema validation: %#v", model)
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
