#!/usr/bin/env python3
"""Load an existing STEP file with OpenCascade and report exact B-rep evidence."""

import json
import math
import sys

import cadquery as cq


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: validate_step.py INPUT.step")
    imported = cq.importers.importStep(sys.argv[1]).val()
    if not imported.isValid():
        raise ValueError("OpenCascade reported invalid STEP topology")
    solids = imported.Solids()
    faces = imported.Faces()
    volume = sum(float(solid.Volume()) for solid in solids)
    if not solids or not faces or not math.isfinite(volume) or volume <= 0:
        raise ValueError("STEP does not contain a finite positive solid B-rep")
    bounds = imported.BoundingBox()
    print(json.dumps({
        "solid_count": len(solids),
        "face_count": len(faces),
        "volume": volume,
        "bounds": [bounds.xmin, bounds.ymin, bounds.zmin, bounds.xmax, bounds.ymax, bounds.zmax],
        "kernel": "CadQuery 2.6.1 / OpenCascade",
        "length_unit": "mm",
        "face_coverage_checked": False,
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
