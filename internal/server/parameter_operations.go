package server

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	flow360api "github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func compilePlanAssistOperations(schema, baseline json.RawMessage, operations []agent.ParameterOperation) (json.RawMessage, error) {
	var baselineValue any
	if json.Unmarshal(baseline, &baselineValue) != nil {
		return nil, errors.New("canonical Flow360 baseline is invalid")
	}
	candidate := clonePlanAssistValue(baselineValue)
	for index, operation := range operations {
		if operation.Op == "create-slice-output" {
			if err := agent.ValidateParameterOperation(operation); err != nil {
				return nil, fmt.Errorf("operation %d: %w", index, err)
			}
			var err error
			candidate, err = compileCreateSliceOutput(schema, candidate, operation)
			if err != nil {
				return nil, fmt.Errorf("operation %d: %w", index, err)
			}
			continue
		}
		segments, err := planAssistOperationPointer(operation.Path)
		if err != nil {
			return nil, fmt.Errorf("operation %d: %w", index, err)
		}
		switch operation.Op {
		case "set":
			current, _ := planAssistValueAt(candidate, segments)
			value := clonePlanAssistValue(operation.Value)
			if currentObject, ok := current.(map[string]any); ok {
				if valueObject, valueOK := value.(map[string]any); valueOK {
					value = mergePlanAssistObjects(currentObject, valueObject)
				}
			}
			if currentArray, ok := current.([]any); ok {
				valueArray, valueOK := value.([]any)
				if valueOK && (planAssistArrayContainsObject(currentArray) || planAssistArrayContainsObject(valueArray)) {
					return nil, fmt.Errorf("operation %d: %s is a complex object array; update an existing item path or append one new item instead of replacing the array", index, operation.Path)
				}
			}
			if err := plans.ValidateFormPointerValue(schema, operation.Path, value); err != nil {
				return nil, fmt.Errorf("operation %d: %w", index, err)
			}
			candidate, err = setPlanAssistValue(candidate, segments, value)
			if err != nil {
				return nil, fmt.Errorf("operation %d: %w", index, err)
			}
		case "unset":
			if err := plans.ValidateFormPointer(schema, operation.Path); err != nil {
				return nil, fmt.Errorf("operation %d: %w", index, err)
			}
			candidate, err = unsetPlanAssistValue(candidate, segments)
			if err != nil {
				return nil, fmt.Errorf("operation %d: %w", index, err)
			}
		case "append":
			if err := plans.ValidateFormPointerAppend(schema, operation.Path, operation.Value); err != nil {
				return nil, fmt.Errorf("operation %d: %w", index, err)
			}
			candidate, err = appendPlanAssistValue(candidate, segments, clonePlanAssistValue(operation.Value))
			if err != nil {
				return nil, fmt.Errorf("operation %d: %w", index, err)
			}
		default:
			return nil, fmt.Errorf("operation %d: unsupported op %q", index, operation.Op)
		}
	}
	return planAssistCanonicalPatch(baseline, mustMarshalPlanAssistValue(candidate))
}

func compileCreateSliceOutput(schema json.RawMessage, candidate any, operation agent.ParameterOperation) (any, error) {
	root, ok := candidate.(map[string]any)
	if !ok {
		return nil, errors.New("canonical Flow360 baseline must be an object")
	}
	unit, err := planAssistProjectLengthUnit(schema, root)
	if err != nil {
		return nil, err
	}
	normal, err := normalizedPlanAssistVector(operation.Normal)
	if err != nil {
		return nil, err
	}
	origin := canonicalPlanAssistVector(operation.Origin)
	fields := append([]string(nil), operation.OutputFields...)
	for index := range fields {
		fields[index] = strings.TrimSpace(fields[index])
	}
	sort.Strings(fields)

	entityInfo, err := planAssistDraftEntityInfo(root)
	if err != nil {
		return nil, err
	}
	registry, err := planAssistObjectArray(entityInfo, "draft_entities")
	if err != nil {
		return nil, err
	}
	semanticKey := planAssistSliceSemanticKey(origin, normal, unit)
	var slice map[string]any
	for _, raw := range registry {
		candidateSlice, _ := raw.(map[string]any)
		if planAssistSameSlice(candidateSlice, origin, normal, unit) {
			slice = candidateSlice
			break
		}
	}
	if slice == nil {
		sliceID := planAssistStablePrivateID("slice", semanticKey, planAssistEntityIDs(registry))
		name := strings.TrimSpace(operation.Name)
		if name == "" {
			name = sliceID
		}
		slice = map[string]any{
			"name":                               name,
			"normal":                             normal,
			"origin":                             map[string]any{"value": origin, "units": unit},
			"private_attribute_entity_type_name": "Slice",
			"private_attribute_id":               sliceID,
		}
		registry = append(registry, slice)
		entityInfo["draft_entities"] = registry
	}
	sliceID := strings.TrimSpace(planAssistString(slice["private_attribute_id"]))
	if sliceID == "" {
		return nil, errors.New("matching Slice registry entity has no private_attribute_id")
	}

	outputs, err := planAssistObjectArray(root, "outputs")
	if err != nil {
		return nil, err
	}
	outputID := planAssistStablePrivateID("slice-output", semanticKey+"|"+strings.Join(fields, ","), planAssistEntityIDs(outputs))
	for _, raw := range outputs {
		output, _ := raw.(map[string]any)
		if planAssistSameSliceOutput(output, slice, fields) {
			if strings.TrimSpace(planAssistString(output["private_attribute_id"])) == "" {
				output["private_attribute_id"] = outputID
			}
			if err := flow360api.ValidateDraftEntityReferences(mustMarshalPlanAssistValue(root)); err != nil {
				return nil, err
			}
			return root, nil
		}
	}

	name := strings.TrimSpace(operation.Name)
	if name == "" {
		name = outputID
	}
	output := map[string]any{
		"output_type":          "SliceOutput",
		"name":                 name,
		"private_attribute_id": outputID,
		"entities": map[string]any{
			"stored_entities": []any{clonePlanAssistValue(slice)},
		},
		"output_fields": map[string]any{"items": planAssistStringsToAny(fields)},
	}
	if err := planAssistValidateSliceOutput(schema, output, slice); err != nil {
		return nil, err
	}
	outputs = append(outputs, output)
	root["outputs"] = outputs
	if err := flow360api.ValidateDraftEntityReferences(mustMarshalPlanAssistValue(root)); err != nil {
		return nil, err
	}
	return root, nil
}

func planAssistDraftEntityInfo(root map[string]any) (map[string]any, error) {
	cache, exists := root["private_attribute_asset_cache"]
	if !exists {
		cache = map[string]any{}
		root["private_attribute_asset_cache"] = cache
	}
	cacheObject, ok := cache.(map[string]any)
	if !ok {
		return nil, errors.New("private_attribute_asset_cache must be an object")
	}
	info, exists := cacheObject["project_entity_info"]
	if !exists {
		info = map[string]any{}
		cacheObject["project_entity_info"] = info
	}
	infoObject, ok := info.(map[string]any)
	if !ok {
		return nil, errors.New("private_attribute_asset_cache.project_entity_info must be an object")
	}
	return infoObject, nil
}

func planAssistObjectArray(object map[string]any, key string) ([]any, error) {
	value, exists := object[key]
	if !exists || value == nil {
		return []any{}, nil
	}
	array, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("%s must be an array", key)
	}
	return array, nil
}

func planAssistProjectLengthUnit(schema json.RawMessage, baseline map[string]any) (string, error) {
	if unitSystem, ok := baseline["unit_system"].(map[string]any); ok {
		switch strings.ToLower(strings.TrimSpace(planAssistString(unitSystem["name"]))) {
		case "si":
			return "m", nil
		case "cgs":
			return "cm", nil
		case "imperial":
			return "ft", nil
		}
	}
	if cache, ok := baseline["private_attribute_asset_cache"].(map[string]any); ok {
		if info, ok := cache["project_entity_info"].(map[string]any); ok {
			for _, raw := range planAssistArray(info["draft_entities"]) {
				entity, _ := raw.(map[string]any)
				if entity["private_attribute_entity_type_name"] != "Slice" {
					continue
				}
				origin, _ := entity["origin"].(map[string]any)
				if unit := planAssistLengthUnit(origin["units"]); unit != "" {
					return unit, nil
				}
			}
		}
	}
	units := map[string]struct{}{}
	planAssistCollectLengthUnits(baseline, units)
	if len(units) == 1 {
		for unit := range units {
			return unit, nil
		}
	}
	var schemaValue any
	if json.Unmarshal(schema, &schemaValue) == nil {
		units = map[string]struct{}{}
		planAssistCollectLengthUnits(schemaValue, units)
		if len(units) == 1 {
			for unit := range units {
				return unit, nil
			}
		}
	}
	return "", errors.New("project length unit could not be derived safely from the canonical baseline or active schema")
}

func planAssistCollectLengthUnits(value any, units map[string]struct{}) {
	switch typed := value.(type) {
	case map[string]any:
		if unit := planAssistLengthUnit(typed["units"]); unit != "" {
			units[unit] = struct{}{}
		}
		if unit := planAssistLengthUnit(typed["unit"]); unit != "" {
			units[unit] = struct{}{}
		}
		for _, child := range typed {
			planAssistCollectLengthUnits(child, units)
		}
	case []any:
		for _, child := range typed {
			planAssistCollectLengthUnits(child, units)
		}
	}
}

func planAssistLengthUnit(value any) string {
	unit := strings.TrimSpace(planAssistString(value))
	switch unit {
	case "m", "cm", "mm", "km", "ft", "in":
		return unit
	}
	return ""
}

func normalizedPlanAssistVector(vector []float64) ([]any, error) {
	if len(vector) != 3 {
		return nil, errors.New("Slice normal must have exactly three components")
	}
	scale := math.Max(math.Abs(vector[0]), math.Max(math.Abs(vector[1]), math.Abs(vector[2])))
	if math.IsNaN(scale) || math.IsInf(scale, 0) || scale == 0 {
		return nil, errors.New("Slice normal must normalize to a finite non-zero vector")
	}
	magnitude := math.Hypot(math.Hypot(vector[0]/scale, vector[1]/scale), vector[2]/scale)
	if math.IsNaN(magnitude) || math.IsInf(magnitude, 0) || magnitude == 0 {
		return nil, errors.New("Slice normal must normalize to a finite non-zero vector")
	}
	result := make([]any, len(vector))
	for index, component := range vector {
		value := (component / scale) / magnitude
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, errors.New("Slice normal must normalize to a finite non-zero vector")
		}
		if math.Abs(value) < 1e-15 {
			value = 0
		}
		result[index] = value
	}
	return result, nil
}

func canonicalPlanAssistVector(vector []float64) []any {
	result := make([]any, len(vector))
	for index, component := range vector {
		if math.Abs(component) < 1e-15 {
			component = 0
		}
		result[index] = component
	}
	return result
}

func planAssistSliceSemanticKey(origin, normal []any, unit string) string {
	encoded, _ := json.Marshal(map[string]any{"origin": origin, "normal": normal, "units": unit})
	return string(encoded)
}

func planAssistStablePrivateID(namespace, semanticKey string, existing map[string]struct{}) string {
	for collision := 0; collision < 16; collision++ {
		digest := sha256.Sum256([]byte(namespace + "\x00" + semanticKey + "\x00" + strconv.Itoa(collision)))
		bytes := append([]byte(nil), digest[:16]...)
		bytes[6] = (bytes[6] & 0x0f) | 0x50
		bytes[8] = (bytes[8] & 0x3f) | 0x80
		id := fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
			bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16])
		if _, used := existing[id]; !used {
			return id
		}
	}
	return fmt.Sprintf("slice-%x", sha256.Sum256([]byte(namespace+semanticKey)))
}

func planAssistEntityIDs(values []any) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, raw := range values {
		object, _ := raw.(map[string]any)
		if id := strings.TrimSpace(planAssistString(object["private_attribute_id"])); id != "" {
			result[id] = struct{}{}
		}
	}
	return result
}

func planAssistSameSlice(entity map[string]any, origin, normal []any, unit string) bool {
	if entity == nil || entity["private_attribute_entity_type_name"] != "Slice" {
		return false
	}
	entityOrigin, _ := entity["origin"].(map[string]any)
	entityNormal, ok := planAssistNormalizedAnyVector(planAssistArray(entity["normal"]))
	if !ok {
		return false
	}
	return planAssistLengthUnit(entityOrigin["units"]) == unit &&
		planAssistEqualNumberVectors(planAssistArray(entityOrigin["value"]), origin) &&
		planAssistEqualNumberVectors(entityNormal, normal)
}

func planAssistNormalizedAnyVector(vector []any) ([]any, bool) {
	if len(vector) != 3 {
		return nil, false
	}
	values := make([]float64, len(vector))
	for index, raw := range vector {
		value, ok := raw.(float64)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, false
		}
		values[index] = value
	}
	scale := math.Max(math.Abs(values[0]), math.Max(math.Abs(values[1]), math.Abs(values[2])))
	if math.IsNaN(scale) || math.IsInf(scale, 0) || scale == 0 {
		return nil, false
	}
	magnitude := math.Hypot(math.Hypot(values[0]/scale, values[1]/scale), values[2]/scale)
	if math.IsNaN(magnitude) || math.IsInf(magnitude, 0) || magnitude == 0 {
		return nil, false
	}
	result := make([]any, len(values))
	for index, value := range values {
		value = (value / scale) / magnitude
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, false
		}
		if math.Abs(value) < 1e-15 {
			value = 0
		}
		result[index] = value
	}
	return result, true
}

func planAssistSameSliceOutput(output, registeredSlice map[string]any, fields []string) bool {
	if output == nil || output["output_type"] != "SliceOutput" {
		return false
	}
	entities, _ := output["entities"].(map[string]any)
	stored := planAssistArray(entities["stored_entities"])
	if len(stored) != 1 {
		return false
	}
	entity, _ := stored[0].(map[string]any)
	if entity == nil || !reflect.DeepEqual(entity, registeredSlice) {
		return false
	}
	outputFields, _ := output["output_fields"].(map[string]any)
	existing := make([]string, 0)
	for _, raw := range planAssistArray(outputFields["items"]) {
		if field, ok := raw.(string); ok {
			existing = append(existing, field)
		}
	}
	sort.Strings(existing)
	return strings.Join(existing, "\x00") == strings.Join(fields, "\x00")
}

func planAssistValidateSliceOutput(schema json.RawMessage, output, slice map[string]any) error {
	var schemaValue any
	if json.Unmarshal(schema, &schemaValue) != nil {
		return errors.New("active Flow360 schema is invalid")
	}
	added := planAssistAddSliceChoice(schemaValue, slice)
	if added == 0 {
		return errors.New("active Flow360 schema does not expose SliceOutput")
	}
	augmented, err := json.Marshal(schemaValue)
	if err != nil {
		return err
	}
	editableOutput, _ := clonePlanAssistValue(output).(map[string]any)
	delete(editableOutput, "private_attribute_id")
	if err := plans.ValidateFormPointerAppend(augmented, "/outputs", editableOutput); err != nil {
		return fmt.Errorf("create-slice-output does not match the active Flow360 schema: %w", err)
	}
	return nil
}

func planAssistAddSliceChoice(value any, slice map[string]any) int {
	added := 0
	switch typed := value.(type) {
	case map[string]any:
		if planAssistIsSliceOutputSchema(typed) {
			properties, _ := typed["properties"].(map[string]any)
			entities, _ := properties["entities"].(map[string]any)
			if entities != nil {
				choices := planAssistArray(entities["entity_choices"])
				choices = append(choices, map[string]any{
					"value":      "Slice:" + planAssistString(slice["private_attribute_id"]),
					"label":      planAssistString(slice["name"]),
					"model_type": "Slice",
					"payload":    clonePlanAssistValue(slice),
				})
				entities["entity_choices"] = choices
				added++
			}
		}
		for _, child := range typed {
			added += planAssistAddSliceChoice(child, slice)
		}
	case []any:
		for _, child := range typed {
			added += planAssistAddSliceChoice(child, slice)
		}
	}
	return added
}

func planAssistIsSliceOutputSchema(schema map[string]any) bool {
	if schema["title"] == "SliceOutput" {
		return true
	}
	properties, _ := schema["properties"].(map[string]any)
	outputType, _ := properties["output_type"].(map[string]any)
	for _, option := range planAssistArray(outputType["options"]) {
		if option == "SliceOutput" {
			return true
		}
	}
	return false
}

func planAssistEqualNumberVectors(left, right []any) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		leftValue, leftOK := left[index].(float64)
		rightValue, rightOK := right[index].(float64)
		if !leftOK || !rightOK || math.Abs(leftValue-rightValue) > 1e-12 {
			return false
		}
	}
	return true
}

func planAssistStringsToAny(values []string) []any {
	result := make([]any, len(values))
	for index, value := range values {
		result[index] = value
	}
	return result
}

func planAssistArray(value any) []any {
	array, _ := value.([]any)
	return array
}

func planAssistString(value any) string {
	text, _ := value.(string)
	return text
}

func mustMarshalPlanAssistValue(value any) json.RawMessage {
	payload, _ := json.Marshal(value)
	return payload
}

func planAssistOperationPointer(pointer string) ([]string, error) {
	if pointer == "" || pointer == "/" || !strings.HasPrefix(pointer, "/") {
		return nil, errors.New("path must be a non-root JSON Pointer")
	}
	raw := strings.Split(strings.TrimPrefix(pointer, "/"), "/")
	if len(raw) > 32 {
		return nil, errors.New("path exceeds the nesting limit")
	}
	segments := make([]string, len(raw))
	for index, segment := range raw {
		segment = strings.ReplaceAll(segment, "~1", "/")
		segment = strings.ReplaceAll(segment, "~0", "~")
		if segment == "" {
			return nil, errors.New("path contains an empty segment")
		}
		segments[index] = segment
	}
	return segments, nil
}

func planAssistValueAt(current any, path []string) (any, bool) {
	if len(path) == 0 {
		return current, true
	}
	if index, err := strconv.Atoi(path[0]); err == nil {
		array, ok := current.([]any)
		if !ok || index < 0 || index >= len(array) {
			return nil, false
		}
		return planAssistValueAt(array[index], path[1:])
	}
	object, ok := current.(map[string]any)
	if !ok {
		return nil, false
	}
	child, exists := object[path[0]]
	if !exists {
		return nil, false
	}
	return planAssistValueAt(child, path[1:])
}

func setPlanAssistValue(current any, path []string, value any) (any, error) {
	if len(path) == 0 {
		return nil, errors.New("cannot replace the SimulationParams root")
	}
	if index, err := strconv.Atoi(path[0]); err == nil {
		array, ok := current.([]any)
		if !ok || index < 0 || index >= len(array) {
			return nil, errors.New("array item does not exist in the canonical baseline")
		}
		if len(path) == 1 {
			if _, replacingObject := array[index].(map[string]any); replacingObject {
				return nil, errors.New("cannot replace an existing object array item; set one of its child paths")
			}
			array[index] = value
			return array, nil
		}
		updated, err := setPlanAssistValue(array[index], path[1:], value)
		if err != nil {
			return nil, err
		}
		array[index] = updated
		return array, nil
	}
	object, ok := current.(map[string]any)
	if !ok {
		return nil, errors.New("operation parent is not an object")
	}
	if len(path) == 1 {
		object[path[0]] = value
		return object, nil
	}
	child, exists := object[path[0]]
	if !exists {
		child = map[string]any{}
	}
	updated, err := setPlanAssistValue(child, path[1:], value)
	if err != nil {
		return nil, err
	}
	object[path[0]] = updated
	return object, nil
}

func unsetPlanAssistValue(current any, path []string) (any, error) {
	if len(path) == 0 {
		return nil, errors.New("cannot remove the SimulationParams root")
	}
	if index, err := strconv.Atoi(path[0]); err == nil {
		array, ok := current.([]any)
		if !ok || index < 0 || index >= len(array) {
			return nil, errors.New("array item does not exist in the canonical baseline")
		}
		if len(path) == 1 {
			return append(array[:index], array[index+1:]...), nil
		}
		updated, err := unsetPlanAssistValue(array[index], path[1:])
		if err != nil {
			return nil, err
		}
		array[index] = updated
		return array, nil
	}
	object, ok := current.(map[string]any)
	if !ok {
		return nil, errors.New("operation parent is not an object")
	}
	if len(path) == 1 {
		delete(object, path[0])
		return object, nil
	}
	child, exists := object[path[0]]
	if !exists {
		return current, nil
	}
	updated, err := unsetPlanAssistValue(child, path[1:])
	if err != nil {
		return nil, err
	}
	object[path[0]] = updated
	return object, nil
}

func appendPlanAssistValue(current any, path []string, value any) (any, error) {
	if existing, found := planAssistValueAt(current, path); found {
		array, ok := existing.([]any)
		if !ok {
			return nil, errors.New("append target is not an array")
		}
		return setPlanAssistValue(current, path, append(array, value))
	}
	return setPlanAssistValue(current, path, []any{value})
}

func planAssistArrayContainsObject(values []any) bool {
	for _, value := range values {
		if _, ok := value.(map[string]any); ok {
			return true
		}
	}
	return false
}
