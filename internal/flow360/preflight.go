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
	maxPreflightOutputSize   = 8 * 1024 * 1024
)

type PreflightIssue struct {
	Level   string   `json:"level"`
	Code    string   `json:"code"`
	Path    string   `json:"path,omitempty"`
	Message string   `json:"message"`
	Stages  []string `json:"stages,omitempty"`
}

type PreflightResult struct {
	SchemaVersion    int                        `json:"schema_version"`
	ValidatorVersion string                     `json:"validator_version,omitempty"`
	Valid            bool                       `json:"valid"`
	Issues           []PreflightIssue           `json:"issues"`
	FormSchema       json.RawMessage            `json:"form_schema"`
	EditorSchemas    map[string]json.RawMessage `json:"editor_schemas,omitempty"`
}

type PlanFormSchema struct {
	SchemaVersion    int                        `json:"schema_version"`
	ValidatorVersion string                     `json:"validator_version,omitempty"`
	SourceType       string                     `json:"source_type"`
	Target           string                     `json:"target"`
	Stages           []string                   `json:"stages"`
	Schemas          map[string]json.RawMessage `json:"schemas"`
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
	for stage, schema := range result.EditorSchemas {
		if !json.Valid(schema) {
			return PreflightResult{}, fmt.Errorf("Flow360 schema preflight returned an invalid %s editor schema", stage)
		}
	}
	return result, nil
}

// PlanFormSchema projects the installed Flow360 SimulationParams schema onto
// exactly the execution stages between source and target. It intentionally
// reuses the preflight bridge so the editor and final validation cannot drift
// to different schema versions.
func (c *Client) PlanFormSchema(
	ctx context.Context,
	rootType string,
	target string,
	params json.RawMessage,
) (PlanFormSchema, error) {
	normalizedRoot, stages, err := preflightLevels(rootType, target)
	if err != nil {
		return PlanFormSchema{}, err
	}
	result, err := c.PreflightSimulationParams(ctx, rootType, target, params)
	if err != nil {
		return PlanFormSchema{}, err
	}
	schemas := make(map[string]json.RawMessage, len(stages))
	for _, stage := range stages {
		schema, ok := result.EditorSchemas[stage]
		if !ok || !json.Valid(schema) {
			return PlanFormSchema{}, fmt.Errorf("Flow360 did not provide the %s editor schema", stage)
		}
		schemas[stage] = append(json.RawMessage(nil), schema...)
	}
	return PlanFormSchema{
		SchemaVersion: result.SchemaVersion, ValidatorVersion: result.ValidatorVersion,
		SourceType: normalizedRoot, Target: target, Stages: stages, Schemas: schemas,
	}, nil
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
from importlib.metadata import version as package_version
from typing import get_args

from pydantic import BaseModel, BeforeValidator
from flow360.component.simulation import services
from flow360_schema import __version__ as schema_version
from flow360_schema.framework.physical_dimensions.dimension_meta import PhysicalDimensionMeta
from flow360_schema.models.functions import math as flow360_math
from flow360_schema.models.simulation.simulation_params import SimulationParams
from unyt import Unit

request_path = sys.argv[1]
with open(request_path, "r", encoding="utf-8") as stream:
    request = json.load(stream)

if request.get("schema_version") != 1:
    raise ValueError("unsupported preflight request version")

params = copy.deepcopy(request["params"])
original_params = copy.deepcopy(params)
# Draft.get_simulation_params() can omit wire metadata that is implicit in the
# server-side Draft context. Local validation needs it explicitly, otherwise
# Flow360 accepts typed Expressions without running their dimension checks.
params.setdefault("version", package_version("flow360"))
params.setdefault("unit_system", {"name": "SI"})
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

# The Flow360 25.10 wire schema intentionally represents every physical
# quantity as {value, units}, but the generated JSON schema does not repeat the
# physical dimension on the free-form units string. Recover that authoritative
# dimension from the public Pydantic model annotations and attach it to the
# matching $defs property before projecting the editor schema. This remains
# generic across all quantity fields; no CFD parameter names are hard-coded.
def model_subclasses(root):
    result = []
    seen = set()
    pending = [root]
    while pending:
        current = pending.pop()
        for child in current.__subclasses__():
            if child in seen:
                continue
            seen.add(child)
            result.append(child)
            pending.append(child)
    return result

def annotation_unit(annotation):
    for item in getattr(annotation, "__metadata__", ()):
        if not isinstance(item, BeforeValidator):
            continue
        for cell in getattr(item.func, "__closure__", ()) or ():
            try:
                value = cell.cell_contents
            except ValueError:
                continue
            if isinstance(value, PhysicalDimensionMeta):
                return value.si_unit
    for child in get_args(annotation):
        if child is type(None):
            continue
        unit = annotation_unit(child)
        if unit:
            return unit
    return None

models_by_name = {}
units_by_field_name = {}
for model in [BaseModel, *model_subclasses(BaseModel)]:
    models_by_name.setdefault(model.__name__, []).append(model)
    for field_name, field in getattr(model, "model_fields", {}).items():
        unit = annotation_unit(field.annotation)
        if unit:
            units_by_field_name.setdefault(field_name, set()).add(unit)
for definition_name, definition in full_schema.get("$defs", {}).items():
    models = models_by_name.get(definition_name, [])
    if not models or not isinstance(definition, dict):
        continue
    properties = definition.get("properties", {})
    for field_name, property_schema in properties.items():
        if not isinstance(property_schema, dict):
            continue
        for model in models:
            field = getattr(model, "model_fields", {}).get(field_name)
            if field is None:
                continue
            unit = annotation_unit(field.annotation)
            if unit:
                property_schema["$units"] = unit
                break
        if "$units" not in property_schema:
            candidate_units = units_by_field_name.get(field_name, set())
            if len(candidate_units) == 1:
                property_schema["$units"] = next(iter(candidate_units))

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
    "meter/second", "cm/second", "ft/second", "km/hr", "mph", "knot",
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
    result = []
    aliases = {}
    try:
        base = Unit(unit.replace("^", "**"))
    except Exception:
        return [unit], {unit: unit}
    for candidate in (unit, *COMMON_UNITS):
        try:
            parsed = Unit(candidate.replace("^", "**"))
            if not base.same_dimensions_as(parsed):
                continue
            # Flow360's active {value, units} wire serializer emits the unyt
            # expression, not the long dimension name (m, m/s, m**2, Pa...).
            canonical = str(parsed.expr)
            aliases[candidate] = canonical
            if canonical not in result:
                result.append(canonical)
        except Exception:
            continue
    return result, aliases

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
    vector = re.search(r"vector(\d+)", name)
    if vector:
        size = int(vector.group(1))
        return {"type": "array", "items": result, "minItems": size, "maxItems": size}
    return result

def expression_unit_syntax(unit):
    if not unit:
        return ""
    return re.sub(r"(?<![A-Za-z0-9_.])([A-Za-z][A-Za-z0-9_]*)", r"u.\1", unit)

def expression_schema(node, inherited_unit=None):
    public_math_names = (
        "abs", "acos", "add", "asin", "atan", "cos", "cross", "dot", "exp",
        "log", "magnitude", "max", "min", "sin", "sqrt", "subtract", "tan",
    )
    result = {
        **metadata(node),
        "type": "expression",
        "wire_discriminator": {"field": "type_name", "value": "expression"},
        "allow_runtime": False,
        "function_suggestions": [
            f"math.{name}()"
            for name in public_math_names
            if hasattr(flow360_math, name)
        ],
    }
    if inherited_unit:
        try:
            parsed = Unit(inherited_unit.replace("^", "**"))
            result["expected_unit"] = str(parsed.expr)
            dimension = str(parsed.dimensions)
            result["expected_dimension"] = {
                "(time)": "time",
                "(length)": "length",
                "(length)/(time)": "velocity",
                "(length)**2": "area",
                "(length)**3": "volume",
                "(mass)/(length)**3": "density",
            }.get(dimension, dimension)
        except Exception:
            result["expected_unit"] = inherited_unit
    return result

def normalize(node, inherited_unit=None):
    if not isinstance(node, dict):
        return {"type": "json"}
    unit = node.get("$units", inherited_unit)
    outer = metadata(node)
    if node.get("$ref") == "#/$defs/Expression":
        return expression_schema(node, unit)
    if "$ref" in node and not node["$ref"].startswith("#/"):
        outer.update(external_numeric(node["$ref"]))
        if unit:
            outer["unit"] = unit
        return outer
    node = dereference(node)
    unit = node.get("$units", unit)
    base = metadata(node)
    base.update({key: value for key, value in outer.items() if key not in base})
    choice_key, choices = alternatives(node)
    if choices:
        if len(choices) == 1:
            resolved = normalize(choices[0], unit)
            resolved.update({key: value for key, value in base.items() if key not in resolved})
            resolved["nullable"] = any(item.get("type") == "null" for item in node[choice_key])
            return resolved
        variants = [normalize(choice, unit) for choice in choices]
        quantity_variant = next((item for item in variants if item.get("type") == "quantity"), None)
        if quantity_variant:
            expected_unit = quantity_variant.get("unit")
            unit_suggestions = [
                expression_unit_syntax(candidate)
                for candidate in quantity_variant.get("unit_options", [])
                if expression_unit_syntax(candidate)
            ]
            for variant in variants:
                if variant.get("type") != "expression":
                    continue
                enriched = expression_schema({}, expected_unit)
                variant.update({key: value for key, value in enriched.items() if key not in variant})
                variant["unit_suggestions"] = unit_suggestions[:8]
                if expected_unit:
                    variant["example"] = f"1 * {expression_unit_syntax(expected_unit)}"
        priority = {"quantity": 0, "number": 1, "integer": 2, "expression": 3, "string": 4, "boolean": 5}
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
        quantity_unit = value_schema.get("$units", unit) if isinstance(value_schema, dict) else unit
        if isinstance(value_schema, dict) and "units" in properties and quantity_unit:
            numeric = normalize(value_schema)
            unit_options, unit_aliases = compatible_units(quantity_unit)
            return {
                **base,
                "type": "quantity",
                "unit": unit_options[0],
                "unit_options": unit_options,
                "unit_aliases": unit_aliases,
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

EDITOR_PATHS = {
    "SurfaceMesh": (
        ("meshing", "defaults", "surface_max_edge_length"),
        ("meshing", "defaults", "surface_edge_growth_rate"),
        ("meshing", "defaults", "curvature_resolution_angle"),
        ("meshing", "defaults", "surface_max_aspect_ratio"),
        ("meshing", "defaults", "surface_max_adaptation_iterations"),
        ("meshing", "defaults", "target_surface_node_count"),
        ("meshing", "refinements"),
        ("meshing", "surface_meshing"),
        ("meshing", "outputs"),
    ),
    "VolumeMesh": (
        ("meshing", "defaults", "boundary_layer_first_layer_thickness"),
        ("meshing", "defaults", "boundary_layer_growth_rate"),
        ("meshing", "defaults", "volume_edge_growth_rate"),
        ("meshing", "defaults", "sliding_interface_tolerance"),
        ("meshing", "gap_treatment_strength"),
        ("meshing", "volume_zones"),
        ("meshing", "refinements"),
        ("meshing", "volume_meshing"),
    ),
    "Case": (
        ("operating_condition",),
        ("models",),
        ("time_stepping",),
        ("run_control",),
        ("reference_geometry",),
        ("outputs",),
        ("user_defined_fields",),
        ("user_defined_dynamics",),
    ),
}

def projected_editor_schema(stage):
    root = {
        "type": "object",
        "title": f"{stage} parameters",
        "description": f"Flow360 parameters relevant to the {stage} execution stage.",
        "properties": {},
        "required": [],
    }
    for path in EDITOR_PATHS.get(stage, ()):
        if path == ("meshing", "defaults", "target_surface_node_count"):
            asset_cache = original_params.get("private_attribute_asset_cache", {})
            supports_target_count = bool(
                asset_cache.get("use_inhouse_mesher")
                or asset_cache.get("use_geometry_AI")
            )
            if not supports_target_count:
                continue
        raw = schema_at_path(path)
        if not raw:
            continue
        leaf = normalize(raw)
        leaf["path"] = ".".join(path)
        leaf["required"] = False
        cursor = root
        for index, segment in enumerate(path):
            if index == len(path) - 1:
                cursor.setdefault("properties", {})[segment] = leaf
                continue
            cursor = cursor.setdefault("properties", {}).setdefault(segment, {
                "type": "object",
                "title": str(segment).replace("_", " ").title(),
                "properties": {},
                "required": [],
            })
    return root

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
            return name, title
    return None, ""

def entity_assignment_schema(issue):
    info = (
        original_params.get("private_attribute_asset_cache", {})
        .get("project_entity_info", {})
    )
    face_ids = info.get("face_ids", [])
    message = issue.get("message", "")
    missing_faces = [name for name in face_ids if name in message]
    ghost_by_name = {
        entity.get("name"): entity
        for entity in info.get("ghost_entities", [])
        if isinstance(entity, dict) and entity.get("name")
    }
    missing_ghosts = [name for name in ghost_by_name if name in message]
    # A mixed physical-Surface + ghost error cannot safely be assigned to one
    # model. Resolve physical faces first, then let the bounded repair loop
    # revalidate and resolve the remaining ghost boundary by its own semantics.
    missing = missing_faces if missing_faces else missing_ghosts
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
        entity_property, entity_title = model_entity_property(expanded)
        if model_type and entity_property:
            variant_by_type[model_type] = (expanded, entity_property, entity_title)

    entity_types = {
        ghost_by_name[name].get("private_attribute_entity_type_name", "GhostSurface")
        if name in ghost_by_name else "Surface"
        for name in missing
    }

    def supports_missing(entity_title):
        return all(entity_type in entity_title for entity_type in entity_types)

    choices = []
    wildcard_candidates = []
    for index, model in enumerate(original_params.get("models") or []):
        model_type = model.get("type") if isinstance(model, dict) else None
        if model_type not in variant_by_type:
            continue
        _, entity_property, entity_title = variant_by_type[model_type]
        if not supports_missing(entity_title):
            continue
        choices.append({
            "value": f"existing:{index}",
            "label": f"{model.get('name') or model_type} · {model_type}",
            "model_type": model_type,
            "entity_property": entity_property,
            "index": index,
        })
        legacy_entities = model.get("entities", {}).get("stored_entities", [])
        if any(
            isinstance(entity, dict) and entity.get("name") == "*"
            for entity in legacy_entities
        ):
            wildcard_candidates.append(f"existing:{index}")
    for model_type, (variant, entity_property, entity_title) in variant_by_type.items():
        if not supports_missing(entity_title):
            continue
        choices.append({
            "value": f"new:{model_type}",
            "label": f"New {variant.get('title') or model_type}",
            "model_type": model_type,
            "entity_property": entity_property,
        })
    if not choices:
        return None

    entities = []
    for name in missing:
        payload = ghost_by_name.get(name)
        if payload is None:
            payload = {
                "name": name,
                "private_attribute_entity_type_name": "Surface",
                "private_attribute_id": name,
                "private_attribute_tag_key": "faceId",
                "private_attribute_sub_components": [name],
            }
        entities.append({"value": name, "label": name, "payload": payload})

    symmetric_ghosts = bool(missing_ghosts) and all(
        name.lower().startswith("symmetric") for name in missing
    )
    symmetry_choice = next((
        choice["value"] for choice in choices
        if choice["model_type"] == "SymmetryPlane"
    ), None)
    if symmetric_ghosts and symmetry_choice:
        recommended_model = symmetry_choice
    else:
        recommended_model = wildcard_candidates[0] if len(wildcard_candidates) == 1 else choices[0]["value"]
    inherited_wildcard = len(wildcard_candidates) == 1 and not symmetric_ghosts
    recommended_choice = next(
        choice for choice in choices if choice["value"] == recommended_model
    )
    reason = (
        "Flow360 identifies this AutomatedFarfield ghost boundary as a symmetry plane; assign the schema-supported SymmetryPlane model."
        if symmetric_ghosts and recommended_choice["model_type"] == "SymmetryPlane" else
        f"The existing {recommended_choice['model_type']} model targeted all physical surfaces with '*'. "
        f"After Geometry expansion, Flow360 needs those {len(missing)} concrete surfaces assigned explicitly."
        if inherited_wildcard else
        f"Reuse the existing {recommended_choice['model_type']} boundary model for the unassigned Geometry surfaces."
    )
    evidence = [
        f"Flow360 reports {len(missing)} unassigned boundaries.",
        f"Existing model: {recommended_choice['label']}.",
    ]
    if inherited_wildcard:
        evidence.append("The existing model used the wildcard selector '*', which expresses an all-surfaces intent.")
    return {
        "type": "entity_assignment",
        "title": "Resolve unassigned surfaces",
        "description": "The Agent prepared a boundary assignment from the current simulation intent and Flow360 evidence.",
        "model_choices": choices,
        "entity_choices": entities,
        "default_model": recommended_model,
        "default_entities": missing,
        "recommendation": {
            "title": f"Assign {recommended_choice['model_type']} to {len(missing)} boundaries",
            "reason": reason,
            "confidence": "high" if inherited_wildcard or symmetric_ghosts else "medium",
            "evidence": evidence,
            "provenance": "flow360_schema_validation" if symmetric_ghosts else "inherited_existing_model",
        },
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

def incompatible_field_recovery(issue):
    message = issue.get("message", "")
    extra_forbidden = issue.get("code") == "extra_forbidden"
    legacy_incompatible = "is not supported by the legacy mesher" in message.lower()
    if not extra_forbidden and not legacy_incompatible:
        return None
    return {
        "type": "field_removal",
        "title": "Remove field rejected by the active Flow360 schema",
        "description": "This inherited or candidate field is incompatible with the selected schema variant and must be removed through JSON merge-patch semantics.",
        "recommendation": {
            "title": "Remove the incompatible field",
            "reason": "Flow360 explicitly rejected this path as an extra input. The schema-safe repair is to remove it while retaining the selected model variant.",
            "confidence": "high",
            "evidence": [message],
            "provenance": "flow360_schema_validation",
        },
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
    leaf = incompatible_field_recovery(issue)
    if leaf is None:
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

editor_schemas = {
    stage: projected_editor_schema(stage)
    for stage in levels
}

print(json.dumps({
    "schema_version": 1,
    "validator_version": str(schema_version),
    "valid": errors is None or len(errors) == 0,
    "issues": issues,
    "form_schema": form_schema,
    "editor_schemas": editor_schemas,
}, ensure_ascii=False, separators=(",", ":")))
`
