#!/usr/bin/env python3
"""Rebuild deterministic T08 automotive wind-tunnel artifacts."""

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
PATCH = HERE / "variants" / "moving-ground.patch.json"


def surface(name: str, entity_id: str, components: list[str]) -> Surface:
    return Surface(
        name=name,
        private_attribute_id=entity_id,
        private_attribute_tag_key="faceName",
        private_attribute_sub_components=components,
    )


def tagged_entity(entity_type, *, entity_id: str, **kwargs):
    return entity_type(private_attribute_id=entity_id, **kwargs)


def build(moving_ground: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    body = surface("body", "00000000-0000-4000-8000-000000000801", [f"body0001_face{i:04d}" for i in range(1, 11)])
    front_left = surface("frontLeftWheel", "00000000-0000-4000-8000-000000000802", [f"body0001_face{i:04d}" for i in range(11, 14)])
    front_right = surface("frontRightWheel", "00000000-0000-4000-8000-000000000803", [f"body0001_face{i:04d}" for i in range(14, 17)])
    rear_left = surface("rearLeftWheel", "00000000-0000-4000-8000-000000000804", [f"body0001_face{i:04d}" for i in range(17, 20)])
    rear_right = surface("rearRightWheel", "00000000-0000-4000-8000-000000000805", [f"body0001_face{i:04d}" for i in range(20, 23)])
    wheels = [front_left, front_right, rear_left, rear_right]

    with fl.SI_unit_system:
        wake = tagged_entity(
            fl.Box,
            entity_id="80000000-0000-4000-8000-000000000801",
            name="Automotive wake corridor",
            center=(5.5, 0, 0.8) * fl.u.m,
            size=(10, 3.2, 2.2) * fl.u.m,
        )
        entity_info = GeometryEntityInfo(
            faceIDs=[component for item in [body, *wheels] for component in item.private_attribute_sub_components],
            faceAttributeNames=["faceName"],
            groupedFaces=[[body, front_left, front_right, rear_left, rear_right]],
            face_group_tag="faceName",
            global_bounding_box=[[-1.45, -0.88, 0.02], [1.95, 0.88, 1.47]],
            draft_entities=[wake],
        )
        floor_type = (
            fl.WheelBelts(
                central_belt_x_range=(-2.0, 3.0) * fl.u.m,
                central_belt_width=1.0 * fl.u.m,
                front_wheel_belt_x_range=(-1.35, -0.50) * fl.u.m,
                front_wheel_belt_y_range=(0.60, 1.05) * fl.u.m,
                rear_wheel_belt_x_range=(0.60, 1.45) * fl.u.m,
                rear_wheel_belt_y_range=(0.60, 1.05) * fl.u.m,
            )
            if moving_ground
            else fl.StaticFloor(friction_patch_x_range=(-2.0, 3.0) * fl.u.m, friction_patch_width=3.0 * fl.u.m)
        )
        farfield = fl.WindTunnelFarfield(
            name="Automotive wind tunnel",
            width=12 * fl.u.m,
            height=5 * fl.u.m,
            inlet_x_position=-8 * fl.u.m,
            outlet_x_position=15 * fl.u.m,
            floor_z_position=0 * fl.u.m,
            floor_type=floor_type,
        )
        ground_surfaces = [fl.WindTunnelFarfield.floor]
        if moving_ground:
            ground_surfaces += [
                fl.WindTunnelFarfield.central_belt,
                fl.WindTunnelFarfield.front_wheel_belts,
                fl.WindTunnelFarfield.rear_wheel_belts,
            ]
        else:
            ground_surfaces += [fl.WindTunnelFarfield.friction_patch]

        car_walls = [fl.Wall(name="Stationary car body", surfaces=[body], use_wall_function=fl.WallFunction(), private_attribute_id="80000000-0000-4000-8000-000000000811")]
        wheel_walls = []
        for name, wheel, center, omega, model_id in (
            ("Front-left wheel", front_left, (-0.92, -0.77, 0.34), 125, "80000000-0000-4000-8000-000000000812"),
            ("Front-right wheel", front_right, (-0.92, 0.77, 0.34), -125, "80000000-0000-4000-8000-000000000813"),
            ("Rear-left wheel", rear_left, (1.05, -0.77, 0.34), 125, "80000000-0000-4000-8000-000000000814"),
            ("Rear-right wheel", rear_right, (1.05, 0.77, 0.34), -125, "80000000-0000-4000-8000-000000000815"),
        ):
            wheel_walls.append(
                fl.Wall(
                    name=name,
                    surfaces=[wheel],
                    use_wall_function=fl.WallFunction(),
                    velocity=(
                        fl.WallRotation(center=center * fl.u.m, axis=(0, 1, 0), angular_velocity=omega * fl.u.rad / fl.u.s)
                        if moving_ground
                        else None
                    ),
                    private_attribute_id=model_id,
                )
            )
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(
                    geometry_accuracy=0.0001 * fl.u.m,
                    surface_max_edge_length=0.12 * fl.u.m,
                    curvature_resolution_angle=12 * fl.u.deg,
                    boundary_layer_first_layer_thickness=0.0005 * fl.u.m,
                    boundary_layer_growth_rate=1.2,
                    volume_edge_growth_rate=1.15,
                ),
                refinements=[
                    fl.SurfaceRefinement(name="Wheel surface resolution", faces=wheels, max_edge_length=0.025 * fl.u.m),
                    fl.UniformRefinement(name="Wake transport resolution", entities=[wake], spacing=0.125 * fl.u.m),
                ],
                volume_zones=[farfield],
            ),
            reference_geometry=fl.ReferenceGeometry(area=2.17 * fl.u.m**2, moment_length=2.7862 * fl.u.m),
            operating_condition=fl.AerospaceCondition(velocity_magnitude=40 * fl.u.m / fl.u.s),
            time_stepping=fl.Steady(max_steps=800),
            models=[
                fl.Fluid(private_attribute_id="80000000-0000-4000-8000-000000000816"),
                fl.Freestream(
                    name="Wind-tunnel open boundaries",
                    surfaces=[farfield.inlet, farfield.outlet, farfield.left, farfield.right, farfield.ceiling],
                    private_attribute_id="80000000-0000-4000-8000-000000000817",
                ),
                fl.Wall(
                    name="Road system",
                    surfaces=ground_surfaces,
                    velocity=([40, 0, 0] * fl.u.m / fl.u.s if moving_ground else None),
                    use_wall_function=fl.WallFunction(),
                    private_attribute_id="80000000-0000-4000-8000-000000000818",
                ),
                *car_walls,
                *wheel_walls,
            ],
            outputs=[
                fl.SurfaceOutput(name="Automotive surface evidence", surfaces=[body, *wheels], output_fields=["Cp", "Cf", "yPlus", "CfVec"], private_attribute_id="80000000-0000-4000-8000-000000000819"),
            ],
            private_attribute_asset_cache=AssetCache(
                project_length_unit=1 * fl.u.m,
                project_entity_info=entity_info,
                use_inhouse_mesher=True,
                use_geometry_AI=True,
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
        if any(not path.exists() or path.read_text() != content for path, content in ((OUTPUT, rendered), (PATCH, patch_rendered))):
            print("T08 artifacts are stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T08 simulation and moving-ground variant are reproducible")
        return 0
    OUTPUT.write_text(rendered)
    PATCH.write_text(patch_rendered)
    print("wrote T08 simulation.json and moving-ground variant")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
