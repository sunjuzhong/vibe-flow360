package aicreate

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// CompleteSimulationPatch resolves the Geometry's concrete CAD faces into the
// generated Wall model. Flow360's Geometry baseline supplies the schema
// version, unit system, farfield, fluid model, outputs, and entity cache; the
// returned patch adds the intent-specific values and replaces the wildcard
// Wall assignment with the actual imported faces.
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
	faces, err := geometryFaces(document)
	if err != nil {
		return nil, err
	}

	foundWall := false
	for _, item := range models {
		model, ok := item.(map[string]any)
		if !ok || !strings.EqualFold(stringValue(model["type"]), "Wall") {
			continue
		}
		delete(model, "surfaces")
		model["entities"] = map[string]any{"stored_entities": faces}
		foundWall = true
	}
	if !foundWall {
		return nil, errors.New("Flow360 Geometry baseline does not contain a Wall boundary model")
	}

	patch, err := cloneMap(desired)
	if err != nil {
		return nil, err
	}
	patch["models"] = models
	return patch, nil
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
