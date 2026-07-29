package flow360

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	preflightContractVersion = 1
	maxPreflightInputSize    = 2 * 1024 * 1024
	maxPreflightOutputSize   = 2 * 1024 * 1024
)

type PreflightIssue struct {
	Level   string   `json:"level"`
	Code    string   `json:"code"`
	Path    string   `json:"path,omitempty"`
	Message string   `json:"message"`
	Stages  []string `json:"stages,omitempty"`
}

type PreflightResult struct {
	SchemaVersion    int              `json:"schema_version"`
	ValidatorVersion string           `json:"validator_version,omitempty"`
	Valid            bool             `json:"valid"`
	Issues           []PreflightIssue `json:"issues"`
	FormSchema       json.RawMessage  `json:"form_schema"`
}

func (c *Client) PreflightSimulationParams(
	ctx context.Context,
	rootType string,
	target string,
	params json.RawMessage,
) (PreflightResult, error) {
	if !json.Valid(params) {
		return PreflightResult{}, errors.New("SimulationParams must be valid JSON")
	}
	if len(params) > maxPreflightInputSize {
		return PreflightResult{}, errors.New("SimulationParams exceeds the preflight size limit")
	}
	normalizedRoot, levels, err := preflightLevels(rootType, target)
	if err != nil {
		return PreflightResult{}, err
	}
	python, err := c.flow360Python()
	if err != nil {
		return PreflightResult{}, err
	}
	request, err := json.Marshal(map[string]any{
		"schema_version": preflightContractVersion,
		"root_type":      normalizedRoot,
		"levels":         levels,
		"params":         json.RawMessage(params),
	})
	if err != nil {
		return PreflightResult{}, fmt.Errorf("encode preflight request: %w", err)
	}
	temp, err := os.CreateTemp("", "vibesim-preflight-*.json")
	if err != nil {
		return PreflightResult{}, fmt.Errorf("create preflight request: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return PreflightResult{}, err
	}
	if _, err := temp.Write(request); err != nil {
		_ = temp.Close()
		return PreflightResult{}, err
	}
	if err := temp.Close(); err != nil {
		return PreflightResult{}, err
	}

	runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	command := exec.CommandContext(runCtx, python, "-c", simulationPreflightBridge, tempPath)
	command.Env = append(os.Environ(), "SIMCLOUD_PROFILE="+strings.TrimSpace(c.Profile))
	var stdout cappedBuffer
	stdout.limit = maxPreflightOutputSize
	var stderr cappedBuffer
	stderr.limit = 32 * 1024
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return PreflightResult{}, errors.New("Flow360 schema preflight timed out")
		}
		message := compactOutput(stderr.Bytes())
		if message == "" {
			message = err.Error()
		}
		return PreflightResult{}, fmt.Errorf("Flow360 schema preflight failed: %s", message)
	}
	if stdout.exceeded {
		return PreflightResult{}, errors.New("Flow360 schema preflight output exceeds the size limit")
	}
	var result PreflightResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		return PreflightResult{}, errors.New("Flow360 schema preflight returned invalid JSON")
	}
	if result.SchemaVersion != preflightContractVersion {
		return PreflightResult{}, fmt.Errorf("unsupported Flow360 preflight contract version %d", result.SchemaVersion)
	}
	if !json.Valid(result.FormSchema) {
		return PreflightResult{}, errors.New("Flow360 schema preflight returned an invalid form schema")
	}
	return result, nil
}

func preflightLevels(rootType, target string) (string, []string, error) {
	root, _, err := resourceCommand(rootType)
	if err != nil {
		return "", nil, err
	}
	rootStage := map[string]int{
		"geometry":     0,
		"surface-mesh": 1,
		"volume-mesh":  2,
		"case":         3,
	}[root]
	targetStage, ok := map[string]int{
		"surface-mesh": 1,
		"volume-mesh":  2,
		"case":         3,
	}[strings.ToLower(strings.TrimSpace(target))]
	if !ok || targetStage < rootStage || rootStage == targetStage && root != "case" {
		return "", nil, fmt.Errorf("%s cannot run up to %s", rootType, target)
	}
	stages := []string{"Geometry", "SurfaceMesh", "VolumeMesh", "Case"}
	start := rootStage + 1
	if rootStage == targetStage {
		start = targetStage
	}
	return stages[rootStage], append([]string(nil), stages[start:targetStage+1]...), nil
}

type cappedBuffer struct {
	bytes.Buffer
	limit    int
	exceeded bool
}

func (b *cappedBuffer) Write(payload []byte) (int, error) {
	original := len(payload)
	remaining := b.limit - b.Len()
	if remaining <= 0 {
		b.exceeded = true
		return original, nil
	}
	if len(payload) > remaining {
		b.exceeded = true
		payload = payload[:remaining]
	}
	_, err := b.Buffer.Write(payload)
	return original, err
}

const simulationPreflightBridge = `
import copy
import json
import re
import sys
import warnings

from flow360.component.simulation import services
from flow360_schema import __version__ as schema_version
from flow360_schema.models.simulation.simulation_params import SimulationParams
from unyt import Unit

request_path = sys.argv[1]
with open(request_path, "r", encoding="utf-8") as stream:
    request = json.load(stream)

if request.get("schema_version") != 1:
    raise ValueError("unsupported preflight request version")

params = request["params"]
root_type = request.get("root_type")
if root_type == "Case":
    root_type = None
levels = request["levels"]
validation_level = levels[0] if len(levels) == 1 else levels

try:
    validated, errors, validation_warnings = services.validate_model(
        params_as_dict=params,
        validated_by=services.ValidationCalledBy.LOCAL,
        root_item_type=root_type,
        validation_level=validation_level,
    )
except Exception as error:
    validated = None
    errors = [{
        "type": "schema_input",
        "loc": [],
        "msg": str(error),
        "ctx": {"relevant_for": levels},
    }]
    validation_warnings = []

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    full_schema = SimulationParams.model_json_schema()

def dereference(node):
    seen = set()
    while isinstance(node, dict) and "$ref" in node:
        ref = node["$ref"]
        if not ref.startswith("#/$defs/") or ref in seen:
            break
        seen.add(ref)
        node = full_schema.get("$defs", {}).get(ref.split("/")[-1], node)
    return node

def metadata(node):
    result = {}
    for key in (
        "title", "description", "default", "minimum", "maximum",
        "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength",
        "minItems", "maxItems", "relevant_for", "conditionally_required",
    ):
        if key in node:
            result[key] = copy.deepcopy(node[key])
    return result

COMMON_UNITS = (
    "meter", "mm", "cm", "km", "inch", "ft",
    "meter/second", "km/hr", "mph", "knot",
    "second", "minute", "hr",
    "Pa", "kPa", "MPa", "bar", "psi",
    "K", "degC", "degF",
    "kg/m**3", "g/cm**3",
    "Pa*s", "cP",
    "degree", "radian",
    "Hz", "rpm",
    "N", "lbf", "N*m", "W", "kW", "W/m**2", "J",
    "kg", "g", "meter**2", "cm**2", "ft**2", "meter**3",
    "meter/second**2", "1/meter",
)

def compatible_units(unit):
    result = [unit]
    try:
        base = Unit(unit)
    except Exception:
        return result
    for candidate in COMMON_UNITS:
        try:
            if candidate not in result and base.same_dimensions_as(Unit(candidate)):
                result.append(candidate)
        except Exception:
            continue
    return result

def alternatives(node):
    for key in ("anyOf", "oneOf"):
        if isinstance(node.get(key), list):
            return key, [item for item in node[key] if item.get("type") != "null"]
    return None, []

def select_variant(node, next_segment, current_value):
    node = dereference(node)
    if not isinstance(node, dict):
        return {}
    props = node.get("properties", {})
    if next_segment in props:
        return node
    _, choices = alternatives(node)
    expanded = [dereference(choice) for choice in choices]
    discriminator = node.get("discriminator")
    if discriminator is None:
        for choice in expanded:
            discriminator = choice.get("discriminator")
            if discriminator:
                break
    if discriminator and isinstance(current_value, dict):
        property_name = discriminator.get("propertyName")
        selected = current_value.get(property_name)
        mapping = discriminator.get("mapping", {})
        ref = mapping.get(selected)
        if isinstance(ref, str):
            return dereference({"$ref": ref})
    containing = [
        choice for choice in expanded
        if isinstance(choice, dict) and next_segment in dereference(choice).get("properties", {})
    ]
    if len(containing) == 1:
        return containing[0]
    for choice in expanded:
        nested = select_variant(choice, next_segment, current_value)
        if next_segment in nested.get("properties", {}):
            return nested
    return node

def schema_at_path(path):
    node = full_schema
    current = params
    for segment in path:
        if isinstance(segment, int):
            node = dereference(node)
            node = dereference(node.get("items", {}))
            current = current[segment] if isinstance(current, list) and segment < len(current) else None
            continue
        node = select_variant(node, segment, current)
        properties = node.get("properties", {})
        if segment not in properties:
            return {}
        node = properties[segment]
        current = current.get(segment) if isinstance(current, dict) else None
    return node

def external_numeric(ref):
    name = ref.rsplit("/", 1)[-1].lower()
    result = {"type": "integer" if "int" in name and "float" not in name else "number"}
    if "positive" in name and "nonnegative" not in name:
        result["exclusiveMinimum"] = 0
    elif "nonnegative" in name:
        result["minimum"] = 0
    return result

def normalize(node):
    if not isinstance(node, dict):
        return {"type": "json"}
    outer = metadata(node)
    if "$ref" in node and not node["$ref"].startswith("#/"):
        outer.update(external_numeric(node["$ref"]))
        if "$units" in node:
            outer["unit"] = node["$units"]
        return outer
    node = dereference(node)
    base = metadata(node)
    base.update({key: value for key, value in outer.items() if key not in base})
    choice_key, choices = alternatives(node)
    if choices:
        if len(choices) == 1:
            resolved = normalize(choices[0])
            resolved.update({key: value for key, value in base.items() if key not in resolved})
            resolved["nullable"] = any(item.get("type") == "null" for item in node[choice_key])
            return resolved
        variants = [normalize(choice) for choice in choices]
        priority = {"quantity": 0, "number": 1, "integer": 2, "string": 3, "boolean": 4}
        variants.sort(key=lambda item: priority.get(item.get("type"), 10))
        return {
            **base,
            "type": "union",
            "variants": variants,
        }
    if "enum" in node:
        return {**base, "type": "enum", "options": copy.deepcopy(node["enum"])}
    if "const" in node:
        return {**base, "type": "enum", "options": [copy.deepcopy(node["const"])]}
    node_type = node.get("type")
    if node_type == "object":
        properties = node.get("properties", {})
        value_schema = properties.get("value")
        if isinstance(value_schema, dict) and "$units" in value_schema:
            numeric = normalize(value_schema)
            return {
                **base,
                "type": "quantity",
                "unit": value_schema["$units"],
                "unit_options": compatible_units(value_schema["$units"]),
                "value_schema": numeric,
            }
        required = set(node.get("required", []))
        return {
            **base,
            "type": "object",
            "properties": {
                name: {**normalize(child), "required": name in required}
                for name, child in properties.items()
                if not name.startswith("private_attribute")
            },
        }
    if node_type == "array":
        return {**base, "type": "array", "items": normalize(node.get("items", {}))}
    if node_type in ("string", "number", "integer", "boolean"):
        return {**base, "type": node_type}
    return {**base, "type": "json"}

def inferred_location(raw):
    location = raw.get("loc", [])
    if location:
        return location
    message = raw.get("msg", "")
    context = raw.get("ctx", {})
    if isinstance(context, dict):
        message += " " + str(context.get("error", ""))
    properties = full_schema.get("properties", {})
    quoted_field = chr(96) + r"([A-Za-z_][A-Za-z0-9_]*)" + chr(96)
    for token in re.findall(quoted_field, message):
        if token in properties:
            return [token]
    return []

def model_entity_property(model_schema):
    model_schema = dereference(model_schema)
    for name, candidate in model_schema.get("properties", {}).items():
        entity_schema = dereference(candidate)
        title = str(entity_schema.get("title", ""))
        stored = entity_schema.get("properties", {}).get("stored_entities", {})
        if "EntityList[" in title and "Surface" in title and stored:
            return name
    return None

def entity_assignment_schema(issue):
    info = (
        params.get("private_attribute_asset_cache", {})
        .get("project_entity_info", {})
    )
    face_ids = info.get("face_ids", [])
    missing = [name for name in face_ids if name in issue.get("message", "")]
    if not missing:
        return None

    models_node = full_schema.get("properties", {}).get("models", {})
    _, model_arrays = alternatives(models_node)
    array_node = next(
        (dereference(item) for item in model_arrays if dereference(item).get("type") == "array"),
        {},
    )
    items_node = array_node.get("items", {})
    _, variants = alternatives(items_node)
    variant_by_type = {}
    for variant in variants:
        expanded = dereference(variant)
        type_schema = expanded.get("properties", {}).get("type", {})
        model_type = type_schema.get("const")
        entity_property = model_entity_property(expanded)
        if model_type and entity_property:
            variant_by_type[model_type] = (expanded, entity_property)

    choices = []
    for index, model in enumerate(params.get("models") or []):
        model_type = model.get("type") if isinstance(model, dict) else None
        if model_type not in variant_by_type:
            continue
        _, entity_property = variant_by_type[model_type]
        choices.append({
            "value": f"existing:{index}",
            "label": f"{model.get('name') or model_type} · {model_type}",
            "model_type": model_type,
            "entity_property": entity_property,
            "index": index,
        })
    for model_type, (variant, entity_property) in variant_by_type.items():
        choices.append({
            "value": f"new:{model_type}",
            "label": f"New {variant.get('title') or model_type}",
            "model_type": model_type,
            "entity_property": entity_property,
        })
    if not choices:
        return None

    entities = [{
        "value": name,
        "label": name,
        "payload": {
            "name": name,
            "private_attribute_entity_type_name": "Surface",
            "private_attribute_id": name,
            "private_attribute_tag_key": "faceId",
            "private_attribute_sub_components": [name],
        },
    } for name in missing]
    return {
        "type": "entity_assignment",
        "title": "Assign boundary conditions",
        "description": "Choose the physical boundary model and assign every unclassified Geometry surface.",
        "model_choices": choices,
        "entity_choices": entities,
        "default_model": choices[0]["value"],
    }

def issue_payload(raw, level):
    location = inferred_location(raw)
    stages = raw.get("ctx", {}).get("relevant_for", [])
    if isinstance(stages, str):
        stages = [stages]
    return {
        "level": level,
        "code": raw.get("type", level),
        "path": ".".join(str(part) for part in location),
        "message": raw.get("msg", str(raw)),
        "stages": stages,
        "_loc": location,
    }

issues = [issue_payload(item, "error") for item in (errors or [])]
for item in validation_warnings or []:
    if isinstance(item, dict):
        issues.append(issue_payload(item, "warning"))
    else:
        issues.append({
            "level": "warning",
            "code": "warning",
            "message": str(item),
            "path": "",
            "stages": [],
            "_loc": [],
        })

form_schema = {"type": "object", "properties": {}, "required": []}
seen_paths = set()
for issue in issues:
    if issue["level"] != "error" or not issue["_loc"]:
        continue
    projected_path = list(issue["_loc"])
    for index, segment in enumerate(projected_path):
        if isinstance(segment, int):
            projected_path = projected_path[:index]
            break
    if not projected_path:
        continue
    path_key = tuple(projected_path)
    if path_key in seen_paths:
        continue
    seen_paths.add(path_key)
    leaf = normalize(schema_at_path(projected_path))
    if projected_path == ["models"]:
        assignment = entity_assignment_schema(issue)
        if assignment is not None:
            leaf = assignment
    leaf["path"] = ".".join(str(part) for part in projected_path)
    leaf["required"] = True
    cursor = form_schema
    for index, segment in enumerate(projected_path):
        if index == len(projected_path) - 1:
            cursor.setdefault("properties", {})[segment] = leaf
            if segment not in cursor.setdefault("required", []):
                cursor["required"].append(segment)
            continue
        child = cursor.setdefault("properties", {}).setdefault(segment, {
            "type": "object",
            "title": str(segment).replace("_", " ").title(),
            "properties": {},
            "required": [],
        })
        if segment not in cursor.setdefault("required", []):
            cursor["required"].append(segment)
        cursor = child

for issue in issues:
    issue.pop("_loc", None)

print(json.dumps({
    "schema_version": 1,
    "validator_version": str(schema_version),
    "valid": errors is None or len(errors) == 0,
    "issues": issues,
    "form_schema": form_schema,
}, ensure_ascii=False, separators=(",", ":")))
`
