#!/usr/bin/env python3
"""Rebuild deterministic T09 single-zone and nested-rotation artifacts."""

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
PATCH = HERE / "variants" / "nested.patch.json"


def surface(name: str, entity_id: str, components: list[str]) -> Surface:
    return Surface(name=name, private_attribute_id=entity_id, private_attribute_tag_key="faceName", private_attribute_sub_components=components)


def entity(kind, entity_id: str, **kwargs):
    return kind(private_attribute_id=entity_id, **kwargs)


def build(nested: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    inner_rotor = surface("innerRotor", "00000000-0000-4000-8000-000000000901", [f"body0001_face{i:04d}" for i in range(1, 10)])
    outer_rotor = surface("outerRotor", "00000000-0000-4000-8000-000000000902", [f"body0001_face{i:04d}" for i in range(10, 25)])

    with fl.SI_unit_system:
        outer_zone = entity(fl.Cylinder, "90000000-0000-4000-8000-000000000901", name="Outer rotor cylinder", center=(0, 0, 0) * fl.u.m, axis=(1, 0, 0), outer_radius=2.2 * fl.u.m, height=1.2 * fl.u.m)
        inner_zone = entity(fl.Sphere, "90000000-0000-4000-8000-000000000902", name="Inner rotor sphere", center=(-0.3, 0, 0) * fl.u.m, radius=1.1 * fl.u.m, axis=(1, 0, 0))
        wake_zone = entity(fl.Cylinder, "90000000-0000-4000-8000-000000000903", name="Rotor wake corridor", center=(3.0, 0, 0) * fl.u.m, axis=(1, 0, 0), outer_radius=2.4 * fl.u.m, height=6 * fl.u.m)
        slice_entity = entity(fl.Slice, "90000000-0000-4000-8000-000000000904", name="Rotor center plane", normal=(0, 1, 0), origin=(0, 0, 0) * fl.u.m)
        farfield = fl.AutomatedFarfield(name="Rotor farfield", relative_size=40)
        farfield_ghost = GhostSphere(name="farfield", private_attribute_id="farfield", center=[0, 0, 0], maxRadius=100)
        info = GeometryEntityInfo(
            faceIDs=[*inner_rotor.private_attribute_sub_components, *outer_rotor.private_attribute_sub_components],
            faceAttributeNames=["faceName"], groupedFaces=[[inner_rotor, outer_rotor]], face_group_tag="faceName",
            global_bounding_box=[[-0.38, -1.8, -1.8], [0.34, 1.8, 1.8]], ghost_entities=[farfield_ghost], draft_entities=[outer_zone, inner_zone, wake_zone, slice_entity],
        )
        zones = [
            farfield,
            fl.RotationVolume(name="Outer cylindrical sliding interface", entities=[outer_zone], enclosed_entities=[outer_rotor, inner_zone] if nested else [outer_rotor, inner_rotor], spacing_axial=0.08 * fl.u.m, spacing_radial=0.08 * fl.u.m, spacing_circumferential=0.08 * fl.u.m),
        ]
        if nested:
            zones.append(fl.RotationSphere(name="Inner spherical sliding interface", entities=[inner_zone], enclosed_entities=[inner_rotor], spacing_circumferential=0.04 * fl.u.m))

        rotations = [fl.Rotation(name="Outer stage rotation", volumes=[outer_zone], spec=fl.AngularVelocity(200 * fl.u.rpm), private_attribute_id="90000000-0000-4000-8000-000000000911")]
        if nested:
            rotations.append(fl.Rotation(name="Inner relative rotation", volumes=[inner_zone], spec=fl.AngularVelocity(-500 * fl.u.rpm), parent_volume=outer_zone, private_attribute_id="90000000-0000-4000-8000-000000000912"))

        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(surface_max_edge_length=0.3 * fl.u.m, curvature_resolution_angle=12 * fl.u.deg, boundary_layer_first_layer_thickness=0.0002 * fl.u.m, boundary_layer_growth_rate=1.2, volume_edge_growth_rate=1.15),
                refinements=[fl.UniformRefinement(name="Rotor wake resolution", entities=[wake_zone], spacing=0.125 * fl.u.m)],
                volume_zones=zones,
                outputs=[fl.MeshSliceOutput(name="Rotating-interface mesh evidence", slices=[slice_entity])],
            ),
            reference_geometry=fl.ReferenceGeometry(area=10.18 * fl.u.m**2, moment_center=(0, 0, 0) * fl.u.m, moment_length=3.6 * fl.u.m),
            operating_condition=fl.AerospaceCondition(velocity_magnitude=20 * fl.u.m / fl.u.s),
            time_stepping=fl.Unsteady(steps=400, step_size=0.001 * fl.u.s, max_pseudo_steps=35),
            models=[
                fl.Fluid(private_attribute_id="90000000-0000-4000-8000-000000000913"),
                fl.Freestream(name="Rotor farfield", surfaces=[farfield.farfield], private_attribute_id="90000000-0000-4000-8000-000000000914"),
                fl.Wall(name="Inner rotor wall", surfaces=[inner_rotor], private_attribute_id="90000000-0000-4000-8000-000000000915"),
                fl.Wall(name="Outer rotor wall", surfaces=[outer_rotor], private_attribute_id="90000000-0000-4000-8000-000000000916"),
                *rotations,
            ],
            outputs=[
                fl.SurfaceOutput(name="Rotor surface evidence", surfaces=[inner_rotor, outer_rotor], output_fields=["Cp", "Cf", "yPlus"], private_attribute_id="90000000-0000-4000-8000-000000000917"),
                fl.SliceOutput(name="Rotor wake evidence", slices=[slice_entity], output_fields=["qcriterion", "vorticity", "Mach"], private_attribute_id="90000000-0000-4000-8000-000000000918"),
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
            print("T09 artifacts are stale; run build_simulation.py", file=sys.stderr); return 1
        print("T09 simulation and nested variant are reproducible"); return 0
    OUTPUT.write_text(rendered); PATCH.write_text(patched); print("wrote T09 simulation.json and nested variant"); return 0


if __name__ == "__main__": raise SystemExit(main())
