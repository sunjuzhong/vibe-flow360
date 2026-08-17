#!/usr/bin/env python3
"""Rebuild deterministic T12 water-riser artifacts."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import pathlib
import sys
from typing import Any

import flow360 as fl
from flow360_schema.framework.param_utils import AssetCache
from flow360_schema.models.entities.surface_entities import GhostSphere, Surface
from flow360_schema.models.entity_info import GeometryEntityInfo

HERE = pathlib.Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
OUTPUT = HERE / "simulation.json"
PATCH = HERE / "variants" / "gravity.patch.json"


def surface(name: str, entity_id: str, components: list[str]) -> Surface:
    return Surface(name=name, private_attribute_id=entity_id, private_attribute_tag_key="faceName", private_attribute_sub_components=components)


def build(gravity_enabled: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    pile = Surface(name="pile", private_attribute_id="00000000-0000-4000-8000-000000001201", private_attribute_tag_key="groupName", private_attribute_sub_components=[f"body0001_face000{i}" for i in range(1, 4)])

    with fl.SI_unit_system:
        water = fl.Water(name="Water", density=1000 * fl.u.kg / fl.u.m**3, dynamic_viscosity=0.001002 * fl.u.Pa * fl.u.s)
        pressure_slice = fl.Slice(name="Pile center plane", normal=(0, 1, 0), origin=(0, 0, 2.0) * fl.u.m, private_attribute_id="12000000-0000-4000-8000-000000001202")
        farfield_ghost = GhostSphere(name="farfield", private_attribute_id="farfield", center=[0, 0, 2], maxRadius=100)
        info = GeometryEntityInfo(
            faceIDs=[*pile.private_attribute_sub_components], faceAttributeNames=["groupName"], groupedFaces=[[pile]], face_group_tag="groupName",
            global_bounding_box=[[-0.1, -0.1, 0], [0.1, 0.1, 4]], ghost_entities=[farfield_ghost], draft_entities=[pressure_slice],
        )
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(surface_max_edge_length=0.04 * fl.u.m, boundary_layer_first_layer_thickness=0.0001 * fl.u.m, boundary_layer_growth_rate=1.2, volume_edge_growth_rate=1.15),
                refinements=[fl.SurfaceRefinement(name="Pile curvature", faces=[pile], max_edge_length=0.025 * fl.u.m), fl.BoundaryLayer(name="Pile boundary layer", faces=[pile], first_layer_thickness=0.0001 * fl.u.m, growth_rate=1.2)],
                volume_zones=[fl.AutomatedFarfield(name="Water farfield", relative_size=40)],
            ),
            reference_geometry=fl.ReferenceGeometry(area=0.8 * fl.u.m**2, moment_center=(0, 0, 2) * fl.u.m, moment_length=4 * fl.u.m),
            operating_condition=fl.LiquidOperatingCondition(velocity_magnitude=2 * fl.u.m / fl.u.s, reference_velocity_magnitude=2 * fl.u.m / fl.u.s, material=water),
            time_stepping=fl.Steady(max_steps=1500),
            models=[
                fl.Fluid(material=water, gravity=fl.Gravity(direction=(0, 0, -1), magnitude=9.81 * fl.u.m / fl.u.s**2) if gravity_enabled else None, private_attribute_id="12000000-0000-4000-8000-000000001211"),
                fl.Freestream(name="Water current farfield", surfaces=[farfield_ghost], private_attribute_id="12000000-0000-4000-8000-000000001212"),
                fl.Wall(name="No-slip pile wall", surfaces=[pile], use_wall_function=fl.WallFunction(), private_attribute_id="12000000-0000-4000-8000-000000001214"),
            ],
            outputs=[
                fl.SurfaceOutput(name="Pile load evidence", surfaces=[pile], output_fields=["Cp", "pressure_pa", "wall_shear_stress_magnitude_pa"], private_attribute_id="12000000-0000-4000-8000-000000001215"),
                fl.SliceOutput(name="Hydrostatic-gradient evidence", slices=[pressure_slice], output_fields=["velocity_m_per_s", "pressure_pa"], private_attribute_id="12000000-0000-4000-8000-000000001216"),
            ],
            private_attribute_asset_cache=AssetCache(project_length_unit=1 * fl.u.m, project_entity_info=info, use_inhouse_mesher=True),
        )
    return json.loads(params.model_dump_json(exclude_none=True))


def merge_patch(source: Any, target: Any) -> Any:
    if not isinstance(source, dict) or not isinstance(target, dict):
        return target if source != target else {}
    patch: dict[str, Any] = {}
    for key in source.keys() - target.keys(): patch[key] = None
    for key, value in target.items():
        if key not in source: patch[key] = value
        else:
            difference = merge_patch(source[key], value)
            if difference != {}: patch[key] = difference
    return patch


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--check", action="store_true"); args = parser.parse_args()
    baseline, variant = build(False), build(True)
    rendered = json.dumps(baseline, indent=2, sort_keys=True) + "\n"; patched = json.dumps(merge_patch(baseline, variant), indent=2, sort_keys=True) + "\n"
    if args.check:
        if any(not path.exists() or path.read_text() != content for path, content in ((OUTPUT, rendered), (PATCH, patched))):
            print("T12 artifacts are stale; run build_simulation.py", file=sys.stderr); return 1
        print("T12 baseline and gravity variant are reproducible"); return 0
    OUTPUT.write_text(rendered); PATCH.write_text(patched); print("wrote T12 simulation.json and gravity variant"); return 0


if __name__ == "__main__": raise SystemExit(main())
