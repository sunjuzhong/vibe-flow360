#!/usr/bin/env python3
"""Rebuild deterministic T07 internal-flow meshing artifacts."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import pathlib
import sys
from typing import Any

import flow360 as fl
from flow360_schema.framework.param_utils import AssetCache
from flow360_schema.models.entities.surface_entities import Surface
from flow360_schema.models.entity_info import GeometryEntityInfo


HERE = pathlib.Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
OUTPUT = HERE / "simulation.json"
FEATURE_PATCH = HERE / "variants" / "feature-aware.patch.json"


def surface(name: str, entity_id: str, components: list[str]) -> Surface:
    return Surface(
        name=name,
        private_attribute_id=entity_id,
        private_attribute_tag_key="faceName",
        private_attribute_sub_components=components,
    )


def build(feature_aware: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    adjacent = surface(
        "adjacent2floor",
        "00000000-0000-4000-8000-000000000701",
        [f"body0001_face000{index}" for index in range(1, 5)],
    )
    floor = surface("floor", "00000000-0000-4000-8000-000000000702", ["body0001_face0005"])
    ceiling = surface("ceiling", "00000000-0000-4000-8000-000000000703", ["body0001_face0006"])
    sphere = surface("sphere", "00000000-0000-4000-8000-000000000704", ["body0001_face0007"])
    strut = surface(
        "strut",
        "00000000-0000-4000-8000-000000000705",
        [f"body0001_face{index:04d}" for index in range(8, 24)],
    )

    with fl.SI_unit_system:
        fluid_zone = fl.SeedpointVolume(
            name="Primary duct fluid",
            point_in_mesh=[(1, 0, 2) * fl.u.m],
            private_attribute_id="70000000-0000-4000-8000-000000000701",
        )
        entity_info = GeometryEntityInfo(
            faceIDs=[component for group in [adjacent, floor, ceiling, sphere, strut] for component in group.private_attribute_sub_components],
            faceAttributeNames=["faceName"],
            groupedFaces=[[adjacent], [floor], [ceiling], [sphere], [strut]],
            face_group_tag="faceName",
            global_bounding_box=[[0, -2, 0], [8, 2, 4]],
            draft_entities=[fluid_zone],
        )
        refinements = []
        if feature_aware:
            refinements = [
                fl.SurfaceRefinement(name="Sphere obstacle", max_edge_length=0.1, faces=[sphere]),
                fl.SurfaceRefinement(name="Thin supports", max_edge_length=0.01, faces=[strut]),
                fl.BoundaryLayer(name="Floor shear layer", first_layer_thickness=1e-5, faces=[floor]),
                fl.PassiveSpacing(name="Floor-adjacent transition", type="projected", faces=[adjacent]),
                fl.PassiveSpacing(name="Ceiling spacing", type="unchanged", faces=[ceiling]),
            ]
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(
                    surface_max_edge_length=1.2 * fl.u.m,
                    curvature_resolution_angle=15 * fl.u.deg,
                    surface_edge_growth_rate=1.2,
                    boundary_layer_first_layer_thickness=1e-6 * fl.u.m,
                    boundary_layer_growth_rate=1.2,
                    volume_edge_growth_rate=1.2,
                ),
                refinement_factor=1.0,
                refinements=refinements,
                volume_zones=[
                    fl.UserDefinedFarfield(name="Closed duct fluid domain"),
                    fl.CustomZones(name="Connected internal fluid", entities=[fluid_zone], element_type="mixed"),
                ],
            ),
            private_attribute_asset_cache=AssetCache(
                project_length_unit=1 * fl.u.m,
                project_entity_info=entity_info,
                use_inhouse_mesher=True,
            ),
        )
    return json.loads(params.model_dump_json(exclude_none=True))


def merge_patch(source: Any, target: Any) -> Any:
    if not isinstance(source, dict) or not isinstance(target, dict):
        return target if source != target else {}
    patch: dict[str, Any] = {}
    for key in source.keys() - target.keys():
        patch[key] = None
    for key, value in target.items():
        if key not in source:
            patch[key] = value
            continue
        difference = merge_patch(source[key], value)
        if difference != {}:
            patch[key] = difference
    return patch


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when generated artifacts are stale")
    args = parser.parse_args()
    baseline = build(False)
    feature_aware = build(True)
    rendered = json.dumps(baseline, indent=2, sort_keys=True) + "\n"
    patch_rendered = json.dumps(merge_patch(baseline, feature_aware), indent=2, sort_keys=True) + "\n"
    if args.check:
        if any(not path.exists() or path.read_text() != content for path, content in ((OUTPUT, rendered), (FEATURE_PATCH, patch_rendered))):
            print("T07 artifacts are stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T07 simulation and feature-aware variant are reproducible")
        return 0
    OUTPUT.write_text(rendered)
    FEATURE_PATCH.write_text(patch_rendered)
    print("wrote T07 simulation.json and feature-aware variant")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
