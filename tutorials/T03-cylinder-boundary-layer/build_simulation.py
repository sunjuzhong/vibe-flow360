#!/usr/bin/env python3
"""Rebuild the deterministic T03 meshing artifact."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import pathlib
import sys

import flow360 as fl
from flow360_schema.framework.param_utils import AssetCache
from flow360_schema.models.entities.surface_entities import Surface
from flow360_schema.models.entity_info import GeometryEntityInfo


HERE = pathlib.Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
OUTPUT = HERE / "simulation.json"


def build() -> dict:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    cylinder = Surface(
        name="cylinder",
        private_attribute_id="00000000-0000-4000-8000-000000000101",
        private_attribute_tag_key="groupName",
        private_attribute_sub_components=[
            "body0001_face0001",
            "body0001_face0002",
            "body0001_face0003",
        ],
    )
    entity_info = GeometryEntityInfo(
        faceIDs=["body0001_face0001", "body0001_face0002", "body0001_face0003"],
        faceAttributeNames=["groupName"],
        groupedFaces=[[cylinder]],
        face_group_tag="groupName",
        global_bounding_box=[[-0.5, -8.5, -0.5], [0.5, 8.5, 0.5]],
    )

    with fl.SI_unit_system:
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(
                    surface_max_edge_length=1,
                    curvature_resolution_angle=15 * fl.u.deg,
                    surface_edge_growth_rate=1.2,
                    boundary_layer_first_layer_thickness=0.01,
                    boundary_layer_growth_rate=1.2,
                ),
                refinements=[
                    fl.SurfaceRefinement(
                        name="Cylinder curvature refinement",
                        faces=[cylinder],
                        max_edge_length=0.25,
                        curvature_resolution_angle=10 * fl.u.deg,
                    ),
                    fl.BoundaryLayer(
                        name="Cylinder boundary layer",
                        faces=[cylinder],
                        first_layer_thickness=0.01,
                        growth_rate=1.2,
                    ),
                ],
                volume_zones=[fl.AutomatedFarfield(relative_size=40)],
            ),
            private_attribute_asset_cache=AssetCache(
                project_length_unit=1 * fl.u.m,
                project_entity_info=entity_info,
                use_inhouse_mesher=True,
            ),
        )
    return json.loads(params.model_dump_json(exclude_none=True))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if simulation.json is stale")
    args = parser.parse_args()
    rendered = json.dumps(build(), indent=2, sort_keys=True) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered:
            print("simulation.json is stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T03 simulation.json is reproducible")
        return 0
    OUTPUT.write_text(rendered)
    print(f"wrote {OUTPUT.relative_to(REPOSITORY)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
