package aicreate

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ValidateImportedGeometryContract reconciles the semantic names authored in
// the STEP file with the concrete entities Flow360 actually imported. This is
// deliberately separate from CAD validation: STEPCAF metadata may be changed
// or dropped by a downstream importer even when OpenCascade round-trips it.
func ValidateImportedGeometryContract(baseline json.RawMessage, geometry Geometry) error {
	var document map[string]any
	if !json.Valid(baseline) || json.Unmarshal(baseline, &document) != nil {
		return errors.New("Flow360 Geometry SimulationParams are invalid")
	}
	if wrapped, ok := document["simulation_params"].(map[string]any); ok {
		document = wrapped
	}
	expected := map[string]bool{}
	for _, result := range geometry.Results {
		for _, face := range result.Faces {
			expected[strings.ToLower(face.Name)] = true
		}
	}
	if len(expected) == 0 {
		return errors.New("the generated STEP does not declare any Flow360 boundary names")
	}

	cache, _ := document["private_attribute_asset_cache"].(map[string]any)
	info, _ := cache["project_entity_info"].(map[string]any)
	groups, _ := info["grouped_faces"].([]any)
	imported := map[string]bool{}
	namedFaceOwners := map[string]int{}
	for _, rawGroup := range groups {
		group, _ := rawGroup.([]any)
		for _, rawEntity := range group {
			entity, _ := rawEntity.(map[string]any)
			if stringValue(entity["private_attribute_tag_key"]) != "builtinName" {
				continue
			}
			name := strings.ToLower(stringValue(entity["name"]))
			if name != "" {
				imported[name] = true
			}
			components, _ := entity["private_attribute_sub_components"].([]any)
			for _, component := range components {
				if id, ok := component.(string); ok && strings.TrimSpace(id) != "" {
					namedFaceOwners[id]++
				}
			}
		}
	}
	missing := make([]string, 0)
	for name := range expected {
		matched := imported[name]
		if !matched {
			for importedName := range imported {
				if strings.HasPrefix(importedName, name+"_") {
					matched = true
					break
				}
			}
		}
		if !matched {
			missing = append(missing, name)
		}
	}

	concreteFaces, _ := geometryFaces(document)
	unnamedCount, overlappingCount := 0, 0
	if len(namedFaceOwners) > 0 {
		for _, rawFace := range concreteFaces {
			face, _ := rawFace.(map[string]any)
			id := stringValue(face["private_attribute_id"])
			if id == "" {
				id = stringValue(face["name"])
			}
			switch namedFaceOwners[id] {
			case 0:
				unnamedCount++
			case 1:
			default:
				overlappingCount++
			}
		}
	}
	if len(missing) == 0 && unnamedCount == 0 && overlappingCount == 0 {
		return nil
	}
	sort.Strings(missing)
	return fmt.Errorf("Flow360 imported Geometry does not satisfy the STEP boundary contract: missing semantic names=%v, unnamed concrete faces=%d, multiply assigned concrete faces=%d", missing, unnamedCount, overlappingCount)
}

// CompleteSimulationPatch resolves named CAD faces into schema-supported
// boundary models. Explicit semantic names produced by the CAD Agent (wall,
// inlet/outlet/farfield, periodic) take precedence; otherwise a physical CAD
// surface retains the safe external-body Wall fallback. AutomatedFarfield's
// symmetric ghost is assigned to SymmetryPlane without asking the user.
func CompleteSimulationPatch(baseline json.RawMessage, desired map[string]any) (map[string]any, error) {
	var document map[string]any
	if !json.Valid(baseline) || json.Unmarshal(baseline, &document) != nil {
		return nil, errors.New("Flow360 Geometry SimulationParams are invalid")
	}
	if wrapped, ok := document["simulation_params"].(map[string]any); ok {
		document = wrapped
	}

	models, ok := cloneSlice(document["models"])
	if !ok || len(models) == 0 {
		return nil, errors.New("Flow360 Geometry baseline does not contain solver and boundary models")
	}
	layout, err := geometryBoundaryLayout(document)
	if err != nil {
		return nil, err
	}

	foundWall := false
	foundFreestream := false
	for _, item := range models {
		model, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch {
		case strings.EqualFold(stringValue(model["type"]), "Wall"):
			setBoundaryEntities(model, layout.Wall)
			foundWall = true
		case strings.EqualFold(stringValue(model["type"]), "Freestream"):
			existing := storedBoundaryEntities(model)
			setBoundaryEntities(model, append(existing, layout.Freestream...))
			foundFreestream = true
		}
	}
	if !foundWall {
		return nil, errors.New("Flow360 Geometry baseline does not contain a Wall boundary model")
	}
	if len(layout.Freestream) > 0 && !foundFreestream {
		models = append(models, map[string]any{
			"type": "Freestream", "name": "Freestream",
			"surfaces": map[string]any{"stored_entities": layout.Freestream},
		})
	}
	if len(layout.Periodic) != 0 {
		if len(layout.Periodic) != 2 {
			return nil, errors.New("named periodic boundaries must form exactly one pair")
		}
		models = append(models, map[string]any{
			"type": "Periodic", "name": "Periodic",
			"surface_pairs": map[string]any{"items": []any{
				map[string]any{"pair": layout.Periodic},
			}},
			"spec": map[string]any{"type_name": "Translational"},
		})
	}
	if layout.Symmetry != nil {
		models = append(models, map[string]any{
			"type": "SymmetryPlane", "name": "Symmetry",
			"surfaces": map[string]any{"stored_entities": []any{layout.Symmetry}},
		})
	}

	patch, err := cloneMap(desired)
	if err != nil {
		return nil, err
	}
	patch["models"] = models
	return patch, nil
}

type boundaryLayout struct {
	Wall       []any
	Freestream []any
	Periodic   []any
	Symmetry   map[string]any
}

func geometryBoundaryLayout(document map[string]any) (boundaryLayout, error) {
	cache, _ := document["private_attribute_asset_cache"].(map[string]any)
	info, _ := cache["project_entity_info"].(map[string]any)
	groups, _ := info["grouped_faces"].([]any)
	var named []any
	for _, rawGroup := range groups {
		group, _ := rawGroup.([]any)
		if len(group) == 0 {
			continue
		}
		first, _ := group[0].(map[string]any)
		if stringValue(first["private_attribute_tag_key"]) == "builtinName" {
			named = group
			break
		}
	}
	if len(named) == 0 {
		faces, err := geometryFaces(document)
		return boundaryLayout{Wall: faces}, err
	}

	layout := boundaryLayout{}
	layout.Symmetry = exactSymmetryGhost(info)
	for _, raw := range named {
		entity, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := strings.ToLower(stringValue(entity["name"]))
		if name == "" || faceCoincidesWithSymmetry(entity, layout.Symmetry) {
			continue
		}
		concrete := concreteFaceEntities(entity)
		switch {
		case strings.Contains(name, "periodic"):
			layout.Periodic = append(layout.Periodic, concrete...)
		case containsAny(name, "inlet", "outlet", "farfield", "freestream", "outer"):
			layout.Freestream = append(layout.Freestream, concrete...)
		default:
			layout.Wall = append(layout.Wall, concrete...)
		}
	}
	if len(layout.Wall)+len(layout.Freestream)+len(layout.Periodic) == 0 {
		return boundaryLayout{}, errors.New("Flow360 Geometry did not expose named CAD faces for boundary assignment")
	}
	return layout, nil
}

func concreteFaceEntities(group map[string]any) []any {
	components, _ := group["private_attribute_sub_components"].([]any)
	if len(components) == 0 {
		return []any{group}
	}
	result := make([]any, 0, len(components))
	for _, raw := range components {
		name, _ := raw.(string)
		if name == "" {
			continue
		}
		result = append(result, map[string]any{
			"name":                               name,
			"private_attribute_entity_type_name": "Surface",
			"private_attribute_id":               name,
			"private_attribute_tag_key":          "faceId",
			"private_attribute_sub_components":   []any{name},
		})
	}
	if len(result) == 0 {
		return []any{group}
	}
	return result
}

func exactSymmetryGhost(info map[string]any) map[string]any {
	ghosts, _ := info["ghost_entities"].([]any)
	for _, raw := range ghosts {
		ghost, _ := raw.(map[string]any)
		if strings.EqualFold(stringValue(ghost["name"]), "symmetric") {
			return ghost
		}
	}
	return nil
}

func faceCoincidesWithSymmetry(face, ghost map[string]any) bool {
	if ghost == nil {
		return false
	}
	normal, ok := numberSlice(ghost["normal_axis"])
	if !ok || len(normal) != 3 {
		return false
	}
	center, ok := numberSlice(ghost["center"])
	if !ok || len(center) != 3 {
		return false
	}
	attributes, _ := face["private_attributes"].(map[string]any)
	bounds, _ := attributes["bounding_box"].([]any)
	if len(bounds) != 2 {
		return false
	}
	low, lowOK := numberSlice(bounds[0])
	high, highOK := numberSlice(bounds[1])
	if !lowOK || !highOK || len(low) != 3 || len(high) != 3 {
		return false
	}
	axis := -1
	for index, value := range normal {
		if value > 0.5 || value < -0.5 {
			axis = index
			break
		}
	}
	if axis < 0 {
		return false
	}
	const tolerance = 1e-9
	return abs(low[axis]-center[axis]) < tolerance && abs(high[axis]-center[axis]) < tolerance
}

func numberSlice(value any) ([]float64, bool) {
	raw, ok := value.([]any)
	if !ok {
		return nil, false
	}
	result := make([]float64, 0, len(raw))
	for _, item := range raw {
		number, ok := item.(float64)
		if !ok {
			return nil, false
		}
		result = append(result, number)
	}
	return result, true
}

func abs(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

func containsAny(value string, candidates ...string) bool {
	for _, candidate := range candidates {
		if strings.Contains(value, candidate) {
			return true
		}
	}
	return false
}

func setBoundaryEntities(model map[string]any, entities []any) {
	property := "surfaces"
	if _, legacy := model["entities"]; legacy {
		property = "entities"
	}
	delete(model, "entities")
	delete(model, "surfaces")
	model[property] = map[string]any{"stored_entities": entities}
}

func storedBoundaryEntities(model map[string]any) []any {
	for _, property := range []string{"surfaces", "entities"} {
		container, _ := model[property].(map[string]any)
		entities, _ := container["stored_entities"].([]any)
		if len(entities) > 0 {
			return append([]any(nil), entities...)
		}
	}
	return nil
}

func geometryFaces(document map[string]any) ([]any, error) {
	cache, _ := document["private_attribute_asset_cache"].(map[string]any)
	info, _ := cache["project_entity_info"].(map[string]any)
	faceTag := stringValue(info["face_group_tag"])
	groups, _ := info["grouped_faces"].([]any)
	faces := make([]any, 0)
	seen := map[string]bool{}
	for _, rawGroup := range groups {
		group, _ := rawGroup.([]any)
		for _, rawEntity := range group {
			entity, ok := rawEntity.(map[string]any)
			if !ok || faceTag == "" || stringValue(entity["private_attribute_tag_key"]) != faceTag {
				continue
			}
			key := stringValue(entity["private_attribute_id"])
			if key == "" {
				key = stringValue(entity["name"])
			}
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			faces = append(faces, entity)
		}
	}
	if len(faces) == 0 {
		return nil, fmt.Errorf("Flow360 Geometry did not expose concrete CAD faces for boundary assignment")
	}
	return faces, nil
}

func cloneMap(value map[string]any) (map[string]any, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var cloned map[string]any
	if err := json.Unmarshal(payload, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func cloneSlice(value any) ([]any, bool) {
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var cloned []any
	if json.Unmarshal(payload, &cloned) != nil {
		return nil, false
	}
	return cloned, true
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}
