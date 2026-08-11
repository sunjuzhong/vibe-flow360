#!/usr/bin/env python3
"""Execute a validated cadquery-dsl-v1 recipe and export exact named STEP bodies."""

import json
import math
import sys

import cadquery as cq
from cadquery.occ_impl.exporters.assembly import exportStepMeta


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
        return draw_profile(cq.Workplane("XZ"), params).revolve(
            float(params["angle"]), (0, 0, 0), (0, 0, 1)
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
    for operation in recipe["operations"]:
        values[operation["id"]] = build(operation, values)
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
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
