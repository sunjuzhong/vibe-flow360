package plans

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
)

type formNode struct {
	Type             string              `json:"type"`
	Properties       map[string]formNode `json:"properties,omitempty"`
	Required         any                 `json:"required,omitempty"`
	Items            *formNode           `json:"items,omitempty"`
	Variants         []formNode          `json:"variants,omitempty"`
	Options          []any               `json:"options,omitempty"`
	ValueKey         string              `json:"value_key,omitempty"`
	AllowCustom      bool                `json:"allow_custom,omitempty"`
	UnitOptions      []string            `json:"unit_options,omitempty"`
	UnitAliases      map[string]string   `json:"unit_aliases,omitempty"`
	ValueSchema      *formNode           `json:"value_schema,omitempty"`
	ModelChoices     []formChoice        `json:"model_choices,omitempty"`
	EntityChoices    []formChoice        `json:"entity_choices,omitempty"`
	Minimum          *float64            `json:"minimum,omitempty"`
	Maximum          *float64            `json:"maximum,omitempty"`
	ExclusiveMinimum *float64            `json:"exclusiveMinimum,omitempty"`
	ExclusiveMaximum *float64            `json:"exclusiveMaximum,omitempty"`
	MinLength        *int                `json:"minLength,omitempty"`
	MaxLength        *int                `json:"maxLength,omitempty"`
	MinItems         *int                `json:"minItems,omitempty"`
	MaxItems         *int                `json:"maxItems,omitempty"`
}

type formChoice struct {
	Value          string         `json:"value"`
	Label          string         `json:"label"`
	ModelType      string         `json:"model_type,omitempty"`
	EntityProperty string         `json:"entity_property,omitempty"`
	Index          *int           `json:"index,omitempty"`
	Payload        map[string]any `json:"payload,omitempty"`
}

func ValidateFormValues(schema, values json.RawMessage) error {
	if !json.Valid(schema) {
		return errors.New("dynamic form schema is invalid")
	}
	var root formNode
	if err := json.Unmarshal(schema, &root); err != nil {
		return errors.New("dynamic form schema is unsupported")
	}
	var value any
	if err := json.Unmarshal(values, &value); err != nil {
		return errors.New("dynamic form values must be valid JSON")
	}
	return validateFormValue(root, value, "", 0)
}

// SanitizeFormValues projects Agent-produced values onto the active Flow360
// form schema. Canonical SimulationParams may contain internal discriminators
// (for example reference_geometry.area.type_name) that are intentionally not
// editable. An Agent can legitimately echo those while changing a sibling
// value; remove only keys the active schema does not expose, then run the
// normal strict validator on the result.
func SanitizeFormValues(schema, values json.RawMessage) (json.RawMessage, []string, error) {
	if !json.Valid(schema) {
		return nil, nil, errors.New("dynamic form schema is invalid")
	}
	var root formNode
	var value any
	if err := json.Unmarshal(schema, &root); err != nil {
		return nil, nil, errors.New("dynamic form schema is unsupported")
	}
	if err := json.Unmarshal(values, &value); err != nil {
		return nil, nil, errors.New("dynamic form values must be valid JSON")
	}
	sanitized, removed, err := sanitizeFormValue(root, value, "", 0)
	if err != nil {
		return nil, nil, err
	}
	payload, err := json.Marshal(sanitized)
	if err != nil {
		return nil, nil, err
	}
	return payload, removed, nil
}

func sanitizeFormValue(schema formNode, value any, path string, depth int) (any, []string, error) {
	if depth > 32 {
		return nil, nil, errors.New("dynamic form nesting exceeds the limit")
	}
	switch schema.Type {
	case "object":
		object, ok := value.(map[string]any)
		if !ok {
			return value, nil, nil
		}
		result := make(map[string]any, len(object))
		removed := make([]string, 0)
		for key, child := range object {
			childSchema, exists := schema.Properties[key]
			childPath := joinFormPath(path, key)
			if !exists {
				if removableCanonicalFormKey(key) {
					removed = append(removed, childPath)
					continue
				}
				// Preserve arbitrary unknown keys so strict validation reports the
				// Agent hallucination and routes it through repair.
				result[key] = child
				continue
			}
			sanitized, childRemoved, err := sanitizeFormValue(childSchema, child, childPath, depth+1)
			if err != nil {
				return nil, nil, err
			}
			result[key] = sanitized
			removed = append(removed, childRemoved...)
		}
		return result, removed, nil
	case "array":
		array, ok := value.([]any)
		if !ok || schema.Items == nil {
			return value, nil, nil
		}
		result := make([]any, 0, len(array))
		removed := make([]string, 0)
		for index, item := range array {
			sanitized, childRemoved, err := sanitizeFormValue(*schema.Items, item, fmt.Sprintf("%s.%d", path, index), depth+1)
			if err != nil {
				return nil, nil, err
			}
			result = append(result, sanitized)
			removed = append(removed, childRemoved...)
		}
		return result, removed, nil
	case "quantity":
		return sanitizeFixedFormObject(value, path, map[string]bool{"value": true, "units": true})
	case "expression":
		return sanitizeFixedFormObject(value, path, map[string]bool{
			"type_name": true, "expression": true, "output_units": true,
		})
	case "entity_assignment":
		return sanitizeFixedFormObject(value, path, map[string]bool{"model": true, "entities": true})
	case "entity_list":
		return sanitizeFixedFormObject(value, path, map[string]bool{"stored_entities": true, "selectors": true})
	case "multi_select":
		valueKey := schema.ValueKey
		if valueKey == "" {
			valueKey = "items"
		}
		return sanitizeFixedFormObject(value, path, map[string]bool{valueKey: true})
	case "union":
		var best any
		var bestRemoved []string
		bestSize := -1
		for _, variant := range schema.Variants {
			candidate, removed, err := sanitizeFormValue(variant, value, path, depth+1)
			if err != nil || validateFormValue(variant, candidate, path, depth+1) != nil {
				continue
			}
			encoded, _ := json.Marshal(candidate)
			if len(encoded) > bestSize {
				best, bestRemoved, bestSize = candidate, removed, len(encoded)
			}
		}
		if bestSize >= 0 {
			return best, bestRemoved, nil
		}
	}
	return value, nil, nil
}

func sanitizeFixedFormObject(value any, path string, allowed map[string]bool) (any, []string, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return value, nil, nil
	}
	result := make(map[string]any, len(object))
	removed := make([]string, 0)
	for key, child := range object {
		if !allowed[key] {
			if removableCanonicalFormKey(key) {
				removed = append(removed, joinFormPath(path, key))
				continue
			}
			result[key] = child
			continue
		}
		result[key] = child
	}
	return result, removed, nil
}

func removableCanonicalFormKey(key string) bool {
	return key == "type_name" || strings.HasPrefix(key, "private_attribute")
}

func validateFormValue(schema formNode, value any, path string, depth int) error {
	if depth > 32 {
		return errors.New("dynamic form nesting exceeds the limit")
	}
	label := path
	if label == "" {
		label = "form"
	}
	switch schema.Type {
	case "object":
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be an object", label)
		}
		for _, key := range requiredFormKeys(schema.Required) {
			if _, exists := object[key]; !exists {
				return fmt.Errorf("%s.%s is required", label, key)
			}
		}
		for key, child := range object {
			childSchema, exists := schema.Properties[key]
			if !exists {
				return fmt.Errorf("%s.%s is not requested by the active Flow360 schema", label, key)
			}
			if err := validateFormValue(childSchema, child, joinFormPath(path, key), depth+1); err != nil {
				return err
			}
		}
	case "array":
		array, ok := value.([]any)
		if !ok {
			return fmt.Errorf("%s must be an array", label)
		}
		if schema.MinItems != nil && len(array) < *schema.MinItems {
			return fmt.Errorf("%s must contain at least %d items", label, *schema.MinItems)
		}
		if schema.MaxItems != nil && len(array) > *schema.MaxItems {
			return fmt.Errorf("%s must contain at most %d items", label, *schema.MaxItems)
		}
		if schema.Items != nil {
			for index, item := range array {
				if err := validateFormValue(*schema.Items, item, fmt.Sprintf("%s.%d", path, index), depth+1); err != nil {
					return err
				}
			}
		}
	case "quantity":
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must contain a numeric value and unit", label)
		}
		for key := range object {
			if key != "value" && key != "units" {
				return fmt.Errorf("%s.%s is not supported", label, key)
			}
		}
		number, exists := object["value"]
		if !exists {
			return fmt.Errorf("%s.value is required", label)
		}
		valueSchema := schema.ValueSchema
		if valueSchema == nil {
			valueSchema = &formNode{Type: "number"}
		}
		if err := validateFormValue(*valueSchema, number, path+".value", depth+1); err != nil {
			return err
		}
		units, exists := object["units"]
		if !exists {
			return fmt.Errorf("%s.units is required", label)
		}
		unit, ok := units.(string)
		if !ok {
			return fmt.Errorf("%s.units must be a string", label)
		}
		canonical := canonicalFormUnit(schema, unit)
		if len(schema.UnitOptions) > 0 && !containsString(schema.UnitOptions, canonical) {
			return fmt.Errorf("%s.units is not supported by the active Flow360 schema", label)
		}
	case "expression":
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be a Flow360 expression", label)
		}
		for key := range object {
			if key != "type_name" && key != "expression" && key != "output_units" {
				return fmt.Errorf("%s.%s is not supported", label, key)
			}
		}
		if discriminator, ok := object["type_name"].(string); !ok || discriminator != "expression" {
			return fmt.Errorf("%s.type_name must be expression", label)
		}
		expression, ok := object["expression"].(string)
		if !ok || strings.TrimSpace(expression) == "" {
			return fmt.Errorf("%s.expression is required", label)
		}
		if outputUnits, exists := object["output_units"]; exists && outputUnits != nil {
			if _, ok := outputUnits.(string); !ok {
				return fmt.Errorf("%s.output_units must be a string", label)
			}
		}
	case "entity_assignment":
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be an entity assignment", label)
		}
		for key := range object {
			if key != "model" && key != "entities" {
				return fmt.Errorf("%s.%s is not supported", label, key)
			}
		}
		model, ok := object["model"].(string)
		if !ok || findFormChoice(schema.ModelChoices, model) == nil {
			return fmt.Errorf("%s.model is not one of the allowed boundary models", label)
		}
		entities, ok := object["entities"].([]any)
		if !ok || len(entities) == 0 {
			return fmt.Errorf("%s.entities must contain at least one Geometry surface", label)
		}
		seen := map[string]bool{}
		for _, raw := range entities {
			entity, ok := raw.(string)
			if !ok || findFormChoice(schema.EntityChoices, entity) == nil {
				return fmt.Errorf("%s.entities contains an unknown Geometry surface", label)
			}
			if seen[entity] {
				return fmt.Errorf("%s.entities contains a duplicate Geometry surface", label)
			}
			seen[entity] = true
		}
	case "entity_list":
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be an entity list", label)
		}
		for key := range object {
			if key != "stored_entities" && key != "selectors" {
				return fmt.Errorf("%s.%s is not supported", label, key)
			}
		}
		entities, ok := object["stored_entities"].([]any)
		if !ok || len(entities) == 0 {
			return fmt.Errorf("%s.stored_entities must contain at least one entity", label)
		}
		seen := map[string]bool{}
		for _, raw := range entities {
			entity, ok := raw.(map[string]any)
			choice := findEntityFormChoice(schema.EntityChoices, entity)
			if !ok || choice == nil {
				return fmt.Errorf("%s.stored_entities contains an unknown entity", label)
			}
			if seen[choice.Value] {
				return fmt.Errorf("%s.stored_entities contains a duplicate entity", label)
			}
			seen[choice.Value] = true
		}
		if selectors, exists := object["selectors"]; exists {
			if _, ok := selectors.([]any); !ok {
				return fmt.Errorf("%s.selectors must be an array", label)
			}
		}
	case "multi_select":
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be a multi-select value", label)
		}
		valueKey := schema.ValueKey
		if valueKey == "" {
			valueKey = "items"
		}
		for key := range object {
			if key != valueKey {
				return fmt.Errorf("%s.%s is not supported", label, key)
			}
		}
		items, ok := object[valueKey].([]any)
		if !ok {
			return fmt.Errorf("%s.%s must be an array", label, valueKey)
		}
		seen := map[string]bool{}
		for _, item := range items {
			encoded, _ := json.Marshal(item)
			identity := string(encoded)
			if seen[identity] {
				return fmt.Errorf("%s.%s contains a duplicate value", label, valueKey)
			}
			seen[identity] = true
			allowed := false
			for _, option := range schema.Options {
				if reflect.DeepEqual(option, item) {
					allowed = true
					break
				}
			}
			customAllowed := false
			if schema.AllowCustom {
				switch item.(type) {
				case string, map[string]any:
					customAllowed = true
				}
			}
			if !allowed && !customAllowed {
				return fmt.Errorf("%s.%s contains a value not allowed by the active Flow360 schema", label, valueKey)
			}
		}
	case "field_removal":
		if value != nil {
			return fmt.Errorf("%s must be removed", label)
		}
	case "number", "integer":
		number, ok := value.(float64)
		if !ok || math.IsInf(number, 0) || math.IsNaN(number) {
			return fmt.Errorf("%s must be a finite number", label)
		}
		if schema.Type == "integer" && number != math.Trunc(number) {
			return fmt.Errorf("%s must be an integer", label)
		}
		if schema.Minimum != nil && number < *schema.Minimum {
			return fmt.Errorf("%s must be at least %v", label, *schema.Minimum)
		}
		if schema.Maximum != nil && number > *schema.Maximum {
			return fmt.Errorf("%s must be at most %v", label, *schema.Maximum)
		}
		if schema.ExclusiveMinimum != nil && number <= *schema.ExclusiveMinimum {
			return fmt.Errorf("%s must be greater than %v", label, *schema.ExclusiveMinimum)
		}
		if schema.ExclusiveMaximum != nil && number >= *schema.ExclusiveMaximum {
			return fmt.Errorf("%s must be less than %v", label, *schema.ExclusiveMaximum)
		}
	case "string":
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("%s must be a string", label)
		}
		if schema.MinLength != nil && len(text) < *schema.MinLength {
			return fmt.Errorf("%s is too short", label)
		}
		if schema.MaxLength != nil && len(text) > *schema.MaxLength {
			return fmt.Errorf("%s is too long", label)
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%s must be true or false", label)
		}
	case "enum":
		for _, option := range schema.Options {
			if reflect.DeepEqual(option, value) {
				return nil
			}
		}
		return fmt.Errorf("%s is not one of the allowed values", label)
	case "union":
		var failures []string
		for _, variant := range schema.Variants {
			if err := validateFormValue(variant, value, path, depth+1); err == nil {
				return nil
			} else {
				failures = append(failures, err.Error())
			}
		}
		return fmt.Errorf("%s does not match an allowed schema: %s", label, strings.Join(failures, "; "))
	case "json":
		return nil
	default:
		return fmt.Errorf("%s uses unsupported form type %q", label, schema.Type)
	}
	return nil
}

func ExpandFormValues(schema, values, current json.RawMessage) (json.RawMessage, error) {
	var root formNode
	var submitted any
	var currentValue any
	if err := json.Unmarshal(schema, &root); err != nil {
		return nil, errors.New("dynamic form schema is unsupported")
	}
	if err := json.Unmarshal(values, &submitted); err != nil {
		return nil, errors.New("dynamic form values must be valid JSON")
	}
	if err := json.Unmarshal(current, &currentValue); err != nil {
		return nil, errors.New("current SimulationParams are invalid")
	}
	expanded, err := expandFormValue(root, submitted, currentValue, 0)
	if err != nil {
		return nil, err
	}
	result, err := json.Marshal(expanded)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func expandFormValue(schema formNode, value, current any, depth int) (any, error) {
	if depth > 32 {
		return nil, errors.New("dynamic form nesting exceeds the limit")
	}
	if schema.Type == "object" {
		object, _ := value.(map[string]any)
		currentObject, _ := current.(map[string]any)
		result := make(map[string]any, len(object))
		for key, child := range object {
			expanded, err := expandFormValue(schema.Properties[key], child, currentObject[key], depth+1)
			if err != nil {
				return nil, err
			}
			result[key] = expanded
		}
		return result, nil
	}
	if schema.Type == "quantity" {
		object, ok := value.(map[string]any)
		if !ok {
			return value, nil
		}
		result := make(map[string]any, len(object))
		for key, item := range object {
			result[key] = item
		}
		if unit, ok := result["units"].(string); ok {
			result["units"] = canonicalFormUnit(schema, unit)
		}
		return result, nil
	}
	if schema.Type == "field_removal" {
		return nil, nil
	}
	if schema.Type != "entity_assignment" {
		return value, nil
	}
	submission, _ := value.(map[string]any)
	selected := findFormChoice(schema.ModelChoices, submission["model"].(string))
	if selected == nil {
		return nil, errors.New("boundary model selection is stale")
	}
	models, ok := current.([]any)
	if !ok {
		return nil, errors.New("current SimulationParams models are unavailable")
	}
	models = append([]any(nil), models...)
	model := map[string]any{
		"type": selected.ModelType,
		"name": selected.ModelType,
	}
	if selected.Index != nil {
		if *selected.Index < 0 || *selected.Index >= len(models) {
			return nil, errors.New("boundary model selection is stale")
		}
		existing, ok := models[*selected.Index].(map[string]any)
		if !ok {
			return nil, errors.New("selected boundary model is invalid")
		}
		model = cloneObject(existing)
	}
	entityIDs, _ := submission["entities"].([]any)
	entities := make([]any, 0, len(entityIDs))
	for _, raw := range entityIDs {
		choice := findFormChoice(schema.EntityChoices, raw.(string))
		if choice == nil {
			return nil, errors.New("Geometry surface selection is stale")
		}
		entities = append(entities, cloneObject(choice.Payload))
	}
	delete(model, "entities")
	model[selected.EntityProperty] = map[string]any{"stored_entities": entities}
	if selected.Index == nil {
		models = append(models, model)
	} else {
		models[*selected.Index] = model
	}
	return models, nil
}

func canonicalFormUnit(schema formNode, unit string) string {
	if canonical, ok := schema.UnitAliases[unit]; ok {
		return canonical
	}
	return unit
}

func findFormChoice(choices []formChoice, value string) *formChoice {
	for index := range choices {
		if choices[index].Value == value {
			return &choices[index]
		}
	}
	return nil
}

func findEntityFormChoice(choices []formChoice, entity map[string]any) *formChoice {
	if entity == nil {
		return nil
	}
	for index := range choices {
		if reflect.DeepEqual(choices[index].Payload, entity) {
			return &choices[index]
		}
	}
	return nil
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func cloneObject(value map[string]any) map[string]any {
	result := make(map[string]any, len(value))
	for key, item := range value {
		result[key] = item
	}
	return result
}

func requiredFormKeys(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if key, ok := item.(string); ok {
			result = append(result, key)
		}
	}
	return result
}

func joinFormPath(path, key string) string {
	if path == "" {
		return key
	}
	return path + "." + key
}
