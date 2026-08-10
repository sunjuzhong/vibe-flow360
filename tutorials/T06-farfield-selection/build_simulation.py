#!/usr/bin/env python3
"""Rebuild deterministic T06 farfield-selection artifacts."""

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
COMPACT_PATCH = HERE / "variants" / "compact-auto.patch.json"
MANUAL_PATCH = HERE / "variants" / "manual-domain.patch.json"


def tagged_entity(entity_type, *, entity_id: str, **kwargs):
    """Create a deterministic Draft entity instead of accepting a random UUID."""
    return entity_type(private_attribute_id=entity_id, **kwargs)


def build(strategy: str) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    body_surface = Surface(
        name="body",
        private_attribute_id="00000000-0000-4000-8000-000000000601",
        private_attribute_tag_key="groupName",
        private_attribute_sub_components=["body0001_face0001"],
    )
    with fl.SI_unit_system:
        wake_cylinder = tagged_entity(
            fl.Cylinder,
            entity_id="60000000-0000-4000-8000-000000000601",
            name="Rotor-envelope boundary",
            axis=(1, 0, 0),
            center=(3, 0, 0) * fl.u.m,
            height=6 * fl.u.m,
            outer_radius=1.5 * fl.u.m,
        )
        wake_envelope = tagged_entity(
            fl.CustomVolume,
            entity_id="60000000-0000-4000-8000-000000000602",
            name="Rotor service volume",
            bounding_entities=[wake_cylinder],
            axis=(1, 0, 0),
            center=(3, 0, 0) * fl.u.m,
        )
        entity_info = GeometryEntityInfo(
            faceIDs=body_surface.private_attribute_sub_components,
            faceAttributeNames=["groupName"],
            groupedFaces=[[body_surface]],
            face_group_tag="groupName",
            global_bounding_box=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            draft_entities=[wake_cylinder, wake_envelope],
        )
        if strategy == "manual":
            farfield = fl.UserDefinedFarfield(
                name="Provided external domain",
            )
        else:
            farfield = fl.AutomatedFarfield(
                name="Generated external domain",
                method="auto",
                relative_size=8 if strategy == "compact" else 20,
                enclosed_entities=[wake_envelope],
            )
        volume_zones = [
            farfield,
            fl.RotationVolume(
                name="Rotor-envelope mesh control",
                entities=[wake_cylinder],
                spacing_axial=0.2 * fl.u.m,
                spacing_radial=0.12 * fl.u.m,
                spacing_circumferential=0.12 * fl.u.m,
            ),
            fl.CustomZones(
                name="Rotor service custom zone",
                entities=[wake_envelope],
                element_type="mixed",
            ),
        ]
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(
                    surface_max_edge_length=0.12 * fl.u.m,
                    curvature_resolution_angle=12 * fl.u.deg,
                    boundary_layer_first_layer_thickness=0.002 * fl.u.m,
                    boundary_layer_growth_rate=1.2,
                    volume_edge_growth_rate=1.15,
                ),
                volume_zones=volume_zones,
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
    baseline = build("automatic")
    compact = build("compact")
    manual = build("manual")
    rendered = json.dumps(baseline, indent=2, sort_keys=True) + "\n"
    compact_rendered = json.dumps(merge_patch(baseline, compact), indent=2, sort_keys=True) + "\n"
    manual_rendered = json.dumps(merge_patch(baseline, manual), indent=2, sort_keys=True) + "\n"
    if args.check:
        expected = ((OUTPUT, rendered), (COMPACT_PATCH, compact_rendered), (MANUAL_PATCH, manual_rendered))
        if any(not path.exists() or path.read_text() != content for path, content in expected):
            print("T06 artifacts are stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T06 simulation and variants are reproducible")
        return 0
    OUTPUT.write_text(rendered)
    COMPACT_PATCH.write_text(compact_rendered)
    MANUAL_PATCH.write_text(manual_rendered)
    print("wrote T06 simulation.json and farfield variant patches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
