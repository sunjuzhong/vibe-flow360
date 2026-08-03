#!/usr/bin/env python3
"""Execute the validated cadquery-dsl-v1 recipe and export one exact STEP solid."""

import json
import math
import sys

import cadquery as cq


def plane_for_axis(axis):
    return {"x": "YZ", "y": "XZ", "z": "XY"}[axis]


def vec(params, name):
    return tuple(float(value) for value in params[name])


def profile(params):
    return [(float(point[0]), float(point[1])) for point in params["profile"]]


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
        return cq.Workplane(plane_for_axis(params.get("axis", "z"))).polyline(profile(params)).close().extrude(float(params["distance"]))
    if op == "revolve":
        if params.get("axis", "z") != "z":
            raise ValueError("revolve currently requires axis z")
        return cq.Workplane("XZ").polyline(profile(params)).close().revolve(
            float(params["angle"]), (0, 0, 0), (0, 0, 1)
        )
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
    result = values[recipe["result"]]
    shape = result.val()
    if not shape.isValid():
        raise ValueError("OpenCascade reported an invalid result")
    solids = shape.Solids()
    if len(solids) != 1:
        raise ValueError(f"expected exactly one closed solid, got {len(solids)}")
    volume = float(shape.Volume())
    if not math.isfinite(volume) or volume <= 0:
        raise ValueError("result has no finite positive volume")
    cq.exporters.export(result, sys.argv[2], exportType="STEP")
    imported = cq.importers.importStep(sys.argv[2]).val()
    if not imported.isValid() or len(imported.Solids()) != 1:
        raise ValueError("exported STEP failed round-trip topology validation")
    bounds = imported.BoundingBox()
    print(json.dumps({
        "solid_count": len(imported.Solids()),
        "face_count": len(imported.Faces()),
        "volume": float(imported.Volume()),
        "bounds": [bounds.xmin, bounds.ymin, bounds.zmin, bounds.xmax, bounds.ymax, bounds.zmax],
        "kernel": "CadQuery 2.6.1 / OpenCascade",
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
