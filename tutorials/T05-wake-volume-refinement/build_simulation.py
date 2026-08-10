#!/usr/bin/env python3
"""Rebuild deterministic T05 wake-volume refinement artifacts."""

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
PATCH = HERE / "variants" / "focused-wake.patch.json"


def tagged_entity(entity_type, *, entity_id: str, **kwargs):
    """Create a deterministic draft entity instead of accepting a random UUID."""
    return entity_type(private_attribute_id=entity_id, **kwargs)


def build(focused: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    cylinder_surface = Surface(
        name="cylinder",
        private_attribute_id="00000000-0000-4000-8000-000000000501",
        private_attribute_tag_key="groupName",
        private_attribute_sub_components=[
            "body0001_face0001",
            "body0001_face0002",
            "body0001_face0003",
        ],
    )
    with fl.SI_unit_system:
        near_body = tagged_entity(
            fl.Sphere,
            entity_id="50000000-0000-4000-8000-000000000501",
            name="Near-body separation region",
            center=(0, 0, 0) * fl.u.m,
            radius=(1.75 if focused else 1.5) * fl.u.m,
        )
        wake_box = tagged_entity(
            fl.Box,
            entity_id="50000000-0000-4000-8000-000000000502",
            name="Downstream wake corridor",
            center=((5.75 if focused else 4.0), 0, 0) * fl.u.m,
            size=((12.5 if focused else 8.0), 2.4, 2.4) * fl.u.m,
        )
        wake_core = tagged_entity(
            fl.Cylinder,
            entity_id="50000000-0000-4000-8000-000000000503",
            name="Wake core",
            axis=(1, 0, 0),
            center=((5.5 if focused else 4.0), 0, 0) * fl.u.m,
            height=(12 if focused else 8) * fl.u.m,
            outer_radius=(0.8 if focused else 1.0) * fl.u.m,
        )
        center_slice = tagged_entity(
            fl.Slice,
            entity_id="50000000-0000-4000-8000-000000000504",
            name="Wake center plane",
            normal=(0, 1, 0),
            origin=(0, 0, 0) * fl.u.m,
        )
        entity_info = GeometryEntityInfo(
            faceIDs=cylinder_surface.private_attribute_sub_components,
            faceAttributeNames=["groupName"],
            groupedFaces=[[cylinder_surface]],
            face_group_tag="groupName",
            global_bounding_box=[[-0.5, -8.5, -0.5], [0.5, 8.5, 0.5]],
            draft_entities=[near_body, wake_box, wake_core, center_slice],
        )
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(
                    surface_max_edge_length=0.3,
                    curvature_resolution_angle=12 * fl.u.deg,
                    boundary_layer_first_layer_thickness=0.01,
                    boundary_layer_growth_rate=1.2,
                    volume_edge_growth_rate=1.12,
                ),
                refinements=[
                    fl.UniformRefinement(
                        name="Resolve separation near the cylinder",
                        entities=[near_body],
                        spacing=(0.125 if focused else 0.25) * fl.u.m,
                    ),
                    fl.StructuredBoxRefinement(
                        name="Align resolution with wake transport",
                        entities=[wake_box],
                        spacing_axis1=(0.24 if focused else 0.35) * fl.u.m,
                        spacing_axis2=(0.08 if focused else 0.16) * fl.u.m,
                        spacing_normal=(0.08 if focused else 0.16) * fl.u.m,
                    ),
                    fl.AxisymmetricRefinement(
                        name="Resolve the cylindrical wake core",
                        entities=[wake_core],
                        spacing_axial=(0.2 if focused else 0.3) * fl.u.m,
                        spacing_radial=(0.07 if focused else 0.14) * fl.u.m,
                        spacing_circumferential=(0.08 if focused else 0.16) * fl.u.m,
                    ),
                ],
                volume_zones=[fl.AutomatedFarfield(relative_size=40)],
                outputs=[
                    fl.MeshSliceOutput(
                        name="Wake refinement evidence",
                        slices=[center_slice],
                        include_crinkled_slices=focused,
                    )
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
    variant = build(True)
    rendered = json.dumps(baseline, indent=2, sort_keys=True) + "\n"
    patch_rendered = json.dumps(merge_patch(baseline, variant), indent=2, sort_keys=True) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered or not PATCH.exists() or PATCH.read_text() != patch_rendered:
            print("T05 artifacts are stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T05 simulation and variant are reproducible")
        return 0
    OUTPUT.write_text(rendered)
    PATCH.write_text(patch_rendered)
    print("wrote T05 simulation.json and focused-wake.patch.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
