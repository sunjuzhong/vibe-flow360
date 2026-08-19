package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/sunjuzhong/vibe-flow360/internal/agent"
	"github.com/sunjuzhong/vibe-flow360/internal/plans"
)

func compilePlanAssistOperations(schema, baseline json.RawMessage, operations []agent.ParameterOperation) (json.RawMessage, error) {
	var baselineValue any
	if json.Unmarshal(baseline, &baselineValue) != nil {
		return nil, errors.New("canonical Flow360 baseline is invalid")
	}
	candidate := clonePlanAssistValue(baselineValue)
	for index, operation := range operations {
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
