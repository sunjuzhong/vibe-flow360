#!/usr/bin/env python3
"""Rebuild the deterministic T01 SimulationParams artifact."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import pathlib
import sys

import flow360 as fl
from flow360_schema.framework.param_utils import AssetCache
from flow360_schema.models.entities.surface_entities import GhostSphere, Surface
from flow360_schema.models.entity_info import GeometryEntityInfo
from flow360_schema.models.simulation.outputs.outputs import ForceOutput


HERE = pathlib.Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
OUTPUT = HERE / "simulation.json"


def find_entity(info: GeometryEntityInfo, name: str, expected_type: type):
    collections = [*info.grouped_faces, info.ghost_entities]
    for collection in collections:
        for entity in collection:
            if entity.name == name and isinstance(entity, expected_type):
                return entity
    raise ValueError(f"missing {expected_type.__name__} entity {name!r}")


def build() -> dict:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    info = GeometryEntityInfo.model_validate(json.loads((HERE / "assets" / "entity-info.json").read_text()))
    aircraft_surfaces = [find_entity(info, name, Surface) for name in ("fuselage", "leftWing", "rightWing")]
    farfield_surface = find_entity(info, "farfield", GhostSphere)
    farfield_zone = fl.AutomatedFarfield(name="Farfield", method="auto", relative_size=50)

    with fl.SI_unit_system:
        wall = fl.Wall(
            name="Aircraft wall",
            surfaces=aircraft_surfaces,
            private_attribute_id="00000000-0000-4000-8000-000000000002",
        )
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(
                    boundary_layer_first_layer_thickness=0.001,
                    surface_max_edge_length=0.5,
                    edge_split_layers=0,
                ),
                volume_zones=[farfield_zone],
            ),
            reference_geometry=fl.ReferenceGeometry(
                area=24,
                moment_center=(4, 0, 0),
                moment_length=2.4,
            ),
            operating_condition=fl.AerospaceCondition(
                velocity_magnitude=100,
                alpha=0 * fl.u.deg,
            ),
            time_stepping=fl.Steady(
                max_steps=1000,
                CFL=fl.RampCFL(initial=1, final=100, ramp_steps=500),
            ),
            models=[
                fl.Fluid(private_attribute_id="00000000-0000-4000-8000-000000000001"),
                wall,
                fl.Freestream(
                    name="Farfield",
                    surfaces=[farfield_surface],
                    private_attribute_id="00000000-0000-4000-8000-000000000003",
                ),
            ],
            outputs=[
                fl.SurfaceOutput(
                    name="Aircraft surface fields",
                    surfaces=aircraft_surfaces,
                    output_fields=["Cp", "Cf", "yPlus", "CfVec"],
                    private_attribute_id="00000000-0000-4000-8000-000000000004",
                ),
                ForceOutput(
                    name="Aircraft forces",
                    models=[wall],
                    output_fields=["CL", "CD"],
                    private_attribute_id="00000000-0000-4000-8000-000000000005",
                ),
            ],
            private_attribute_asset_cache=AssetCache(
                project_length_unit=1 * fl.u.m,
                project_entity_info=info,
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
        print("T01 simulation.json is reproducible")
        return 0
    OUTPUT.write_text(rendered)
    print(f"wrote {OUTPUT.relative_to(REPOSITORY)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
