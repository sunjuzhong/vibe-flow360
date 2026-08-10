package flow360

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

var draftEntityTypeNames = map[string]struct{}{
	"AxisymmetricBody": {}, "Box": {}, "CustomVolume": {}, "Cylinder": {},
	"Point": {}, "PointArray": {}, "PointArray2D": {}, "SeedpointVolume": {},
	"Slice": {}, "Sphere": {}, "VoxelGrid": {},
}

// ValidateDraftEntityReferences enforces the same ownership invariant used by
// Flow360 DraftContext: every parameter reference to a user-created volume or
// output entity must resolve through project_entity_info.draft_entities.
func ValidateDraftEntityReferences(params json.RawMessage) error {
	var document map[string]any
	if json.Unmarshal(params, &document) != nil || document == nil {
		return errors.New("Draft SimulationParams must be a JSON object")
	}
	cache, _ := document["private_attribute_asset_cache"].(map[string]any)
	entityInfo, _ := cache["project_entity_info"].(map[string]any)
	registered := map[string]struct{}{}
	for _, candidate := range anySlice(entityInfo["draft_entities"]) {
		entity, _ := candidate.(map[string]any)
		id := strings.TrimSpace(stringValue(entity["private_attribute_id"]))
		if id == "" {
			return errors.New("Draft entity registry contains an entity without private_attribute_id")
		}
		registered[id] = struct{}{}
	}

	missing := map[string]struct{}{}
	var visit func(any, bool)
	visit = func(value any, insideRegistry bool) {
		switch current := value.(type) {
		case map[string]any:
			typeName := strings.TrimSpace(stringValue(current["private_attribute_entity_type_name"]))
			if _, isDraftEntity := draftEntityTypeNames[typeName]; isDraftEntity && !insideRegistry {
				id := strings.TrimSpace(stringValue(current["private_attribute_id"]))
				if _, ok := registered[id]; id == "" || !ok {
					name := strings.TrimSpace(stringValue(current["name"]))
					if name == "" {
						name = typeName
					}
					missing[name] = struct{}{}
				}
			}
			for key, child := range current {
				visit(child, insideRegistry || key == "draft_entities")
			}
		case []any:
			for _, child := range current {
				visit(child, insideRegistry)
			}
		}
	}
	visit(document, false)
	if len(missing) == 0 {
		return nil
	}
	names := make([]string, 0, len(missing))
	for name := range missing {
		names = append(names, name)
	}
	sort.Strings(names)
	return fmt.Errorf("Draft entity references are not registered in project_entity_info.draft_entities: %s", strings.Join(names, ", "))
}

func anySlice(value any) []any {
	items, _ := value.([]any)
	return items
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}
