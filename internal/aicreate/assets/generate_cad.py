#!/usr/bin/env python3
"""Execute a validated cadquery-dsl-v1 recipe and export exact named STEP bodies."""

import json
import math
import sys

import cadquery as cq
from cadquery.occ_impl.exporters.assembly import exportStepMeta


def operation_evidence(identifier, operation, result):
    shape = result.val()
    solids = shape.Solids() if shape is not None else []
    faces = shape.Faces() if shape is not None else []
    volume = sum(float(solid.Volume()) for solid in solids)
    bounds = []
    if shape is not None and not shape.isNull():
        box = shape.BoundingBox()
        bounds = [box.xmin, box.ymin, box.zmin, box.xmax, box.ymax, box.zmax]
    return {
        "id": identifier,
        "operation": operation,
        "valid": bool(shape is not None and shape.isValid()),
        "solid_count": len(solids),
        "face_count": len(faces),
        "volume": volume,
        "bounds": bounds,
    }


def raise_diagnostic(code, operation, message, **details):
    diagnostic = {
        "code": code,
        "operation_id": operation["id"],
        "operation": operation["op"],
        "message": message,
    }
    diagnostic.update(details)
    raise ValueError("CAD_DIAGNOSTIC " + json.dumps(diagnostic, separators=(",", ":")))


def axis_relationships(left_bounds, right_bounds):
    scale = max(left_bounds[3 + axis] - left_bounds[axis] for axis in range(3))
    tolerance = max(scale * 1e-7, 1e-9)
    relationships = []
    for axis in range(3):
        left_min, left_max = left_bounds[axis], left_bounds[axis + 3]
        right_min, right_max = right_bounds[axis], right_bounds[axis + 3]
        if right_max < left_min - tolerance or right_min > left_max + tolerance:
            relationships.append("outside")
        elif right_min > left_min + tolerance and right_max < left_max - tolerance:
            relationships.append("inside")
        elif right_min <= left_min + tolerance and right_max >= left_max - tolerance:
            relationships.append("span")
        elif abs(right_min - left_min) <= tolerance and right_max < left_max - tolerance:
            relationships.append("touch-min")
        elif abs(right_max - left_max) <= tolerance and right_min > left_min + tolerance:
            relationships.append("touch-max")
        else:
            relationships.append("cross")
    return relationships


def validate_external_fluid_cut(operation, values, diagnostics):
    relationship = operation["params"].get("domain_relationship")
    if not relationship:
        return
    left_id, right_id = operation["params"]["left"], operation["params"]["right"]
    left, right = diagnostics[left_id], diagnostics[right_id]
    relationships = axis_relationships(left["bounds"], right["bounds"])
    valid = (
        relationship == "enclosed" and relationships == ["inside", "inside", "inside"]
    ) or (
        relationship == "span-through" and relationships.count("span") == 1 and relationships.count("inside") == 2
    ) or (
        relationship == "symmetry-half" and sum(item in ("touch-min", "touch-max") for item in relationships) == 1 and relationships.count("inside") == 2
    )
    if not valid:
        raise_diagnostic(
            "EXTERNAL_FLUID_RELATIONSHIP_MISMATCH",
            operation,
            "Obstacle bounds do not satisfy the declared external-fluid domain relationship.",
            domain_relationship=relationship,
            axis_relationships=relationships,
            operands={"left": left, "right": right},
        )


def plane_for_axis(axis):
    return {"x": "YZ", "y": "XZ", "z": "XY"}[axis]


def vec(params, name):
    return tuple(float(value) for value in params[name])


def profile(params):
    return [(float(point[0]), float(point[1])) for point in params["profile"]]


def draw_profile(workplane, params):
    if params.get("profile_type", "polyline") == "spline":
        return workplane.spline(profile(params)).close()
    return workplane.polyline(profile(params)).close()


def loft(params):
    sections = params["sections"]
    workplane = cq.Workplane(plane_for_axis(params.get("axis", "z")))
    previous_offset = 0.0
    for index, section in enumerate(sections):
        offset = float(section["offset"])
        if index:
            workplane = workplane.workplane(offset=offset - previous_offset)
        elif offset:
            workplane = workplane.workplane(offset=offset)
        workplane = draw_profile(workplane, section)
        previous_offset = offset
    return workplane.loft(combine=True)


def sweep(params):
    points = [cq.Vector(*(float(value) for value in point)) for point in params["path"]]
    path = cq.Workplane("XY").newObject([cq.Wire.assembleEdges([cq.Edge.makeSpline(points)])])
    return (
        draw_profile(cq.Workplane(params["profile_plane"]), params)
        .sweep(path, isFrenet=True)
    )


def build(operation, values):
    op = operation["op"]
    params = operation["params"]
    if op == "box":
        return cq.Workplane("XY").box(float(params["length"]), float(params["width"]), float(params["height"]))
    if op == "cylinder":
        return cq.Workplane(plane_for_axis(params.get("axis", "z"))).cylinder(float(params["height"]), float(params["radius"]))
    if op == "sphere":
        return cq.Workplane("XY").sphere(float(params["radius"]))
    if op == "cone":
        return cq.Workplane(plane_for_axis(params.get("axis", "z"))).cone(
            float(params["height"]), float(params["radius1"]), float(params["radius2"])
        )
    if op == "extrude":
        return draw_profile(cq.Workplane(plane_for_axis(params.get("axis", "z"))), params).extrude(float(params["distance"]))
    if op == "revolve":
        if params.get("axis", "z") != "z":
            raise ValueError("revolve currently requires axis z")
        # CadQuery interprets revolve axes in the current workplane's local
        # coordinates. On XZ, local +Y is global +Z. Passing a world-space
        # three-vector here is transformed a second time and revolves about
        # the workplane normal instead of the requested global Z axis.
        return draw_profile(cq.Workplane("XZ"), params).revolve(
            float(params["angle"]), (0, 0), (0, 1)
        )
    if op == "loft":
        return loft(params)
    if op == "sweep":
        return sweep(params)
    if op == "translate":
        return values[params["source"]].translate(vec(params, "vector"))
    if op == "rotate":
        return values[params["source"]].rotate(vec(params, "axis_start"), vec(params, "axis_end"), float(params["angle"]))
    if op == "union":
        return values[params["left"]].union(values[params["right"]])
    if op == "cut":
        return values[params["left"]].cut(values[params["right"]])
    if op == "intersect":
        return values[params["left"]].intersect(values[params["right"]])
    if op == "fillet":
        return values[params["source"]].edges().fillet(float(params["radius"]))
    raise ValueError(f"unsupported operation: {op}")


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate_cad.py RECIPE OUTPUT.step")
    with open(sys.argv[1], "r", encoding="utf-8") as stream:
        recipe = json.load(stream)
    values = {}
    operation_diagnostics = {}
    for operation in recipe["operations"]:
        try:
            if operation["op"] == "cut":
                validate_external_fluid_cut(operation, values, operation_diagnostics)
            result = build(operation, values)
        except ValueError as error:
            if str(error).startswith("CAD_DIAGNOSTIC "):
                raise
            raise_diagnostic("OPERATION_BUILD_FAILED", operation, str(error))
        except Exception as error:
            raise_diagnostic("OPERATION_BUILD_FAILED", operation, f"{type(error).__name__}: {error}")
        evidence = operation_evidence(operation["id"], operation["op"], result)
        if not evidence["valid"] or evidence["solid_count"] < 1 or not math.isfinite(evidence["volume"]) or evidence["volume"] <= 0:
            code = "OPERATION_INVALID_SOLID"
            if operation["op"] in ("cut", "intersect"):
                code = "BOOLEAN_RESULT_EMPTY" if evidence["solid_count"] < 1 or evidence["volume"] <= 0 else "BOOLEAN_RESULT_INVALID"
            operands = {}
            for role in ("left", "right", "source"):
                source = operation["params"].get(role)
                if source in operation_diagnostics:
                    operands[role] = operation_diagnostics[source]
            raise_diagnostic(code, operation, "Operation did not produce a valid finite positive solid.", result=evidence, operands=operands)
        values[operation["id"]] = result
        operation_diagnostics[operation["id"]] = evidence
    specifications = recipe.get("results") or [{
        "source": recipe["result"], "name": recipe["name"], "faces": []
    }]
    assembly = cq.Assembly(name=f"{recipe['name']}-assembly")
    body_names = []
    face_names = []
    shapes = []
    face_coverage_checked = bool(recipe.get("results")) and all(
        specification.get("faces") for specification in specifications
    )
    named_face_count = 0
    unnamed_face_count = 0
    overlapping_face_count = 0
    for specification in specifications:
        result = values[specification["source"]]
        shape = result.val()
        if not shape.isValid() or len(shape.Solids()) < 1:
            raise ValueError(f"OpenCascade reported invalid or non-solid result: {specification['source']}")
        body_name = specification["name"]
        assembly.add(result, name=body_name)
        body_names.append(body_name)
        shapes.append(shape)
        body_faces = result.faces().vals()
        face_assignments = [0] * len(body_faces)
        for face_specification in specification.get("faces", []):
            selected = result.faces(face_specification["selector"]).vals()
            if not selected:
                raise ValueError(
                    f"face selector {face_specification['selector']} matched no faces in {body_name}"
                )
            for index, face in enumerate(selected, 1):
                face_name = face_specification["name"]
                if len(selected) > 1:
                    face_name = f"{face_name}_{index:03d}"
                assembly.objects[body_name].addSubshape(
                    face, name=face_name, layer=face_specification["name"]
                )
                face_names.append(face_name)
                matches = [
                    body_index for body_index, body_face in enumerate(body_faces)
                    if face.isSame(body_face)
                ]
                if len(matches) != 1:
                    raise ValueError(
                        f"could not map named face {face_name} to exactly one result face in {body_name}"
                    )
                face_assignments[matches[0]] += 1
        if face_coverage_checked:
            named_face_count += sum(count > 0 for count in face_assignments)
            unnamed_face_count += sum(count == 0 for count in face_assignments)
            overlapping_face_count += sum(count > 1 for count in face_assignments)
    compound = assembly.toCompound()
    if not compound.isValid():
        raise ValueError("OpenCascade reported an invalid multi-body compound")
    solids = compound.Solids()
    volume = sum(float(solid.Volume()) for solid in solids)
    if not math.isfinite(volume) or volume <= 0:
        raise ValueError("result has no finite positive volume")
    if not exportStepMeta(assembly, sys.argv[2]):
        raise ValueError("OpenCascade STEPCAF export failed")
    imported = cq.importers.importStep(sys.argv[2]).val()
    if not imported.isValid() or len(imported.Solids()) != len(solids):
        raise ValueError("exported STEP failed round-trip topology validation")
    bounds = imported.BoundingBox()
    print(json.dumps({
        "solid_count": len(imported.Solids()),
        "face_count": len(imported.Faces()),
        "volume": float(imported.Volume()),
        "bounds": [bounds.xmin, bounds.ymin, bounds.zmin, bounds.xmax, bounds.ymax, bounds.zmax],
        "kernel": "CadQuery 2.6.1 / OpenCascade",
        "length_unit": "mm",
        "body_names": body_names,
        "face_names": face_names,
        "face_coverage_checked": face_coverage_checked,
        "named_face_count": named_face_count,
        "unnamed_face_count": unnamed_face_count,
        "overlapping_face_count": overlapping_face_count,
        "operation_diagnostics": list(operation_diagnostics.values()),
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
