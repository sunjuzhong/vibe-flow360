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
	ValueSchema      *formNode           `json:"value_schema,omitempty"`
	Minimum          *float64            `json:"minimum,omitempty"`
	Maximum          *float64            `json:"maximum,omitempty"`
	ExclusiveMinimum *float64            `json:"exclusiveMinimum,omitempty"`
	ExclusiveMaximum *float64            `json:"exclusiveMaximum,omitempty"`
	MinLength        *int                `json:"minLength,omitempty"`
	MaxLength        *int                `json:"maxLength,omitempty"`
	MinItems         *int                `json:"minItems,omitempty"`
	MaxItems         *int                `json:"maxItems,omitempty"`
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
		if units, exists := object["units"]; exists {
			if _, ok := units.(string); !ok {
				return fmt.Errorf("%s.units must be a string", label)
			}
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
