#!/usr/bin/env python3
"""Rebuild deterministic T17 source, cold-start, expression, and restart artifacts."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import pathlib
import sys
from typing import Any, Literal

import flow360 as fl
from flow360_schema.framework.param_utils import AssetCache
from flow360_schema.models.entities.surface_entities import GhostSphere, Surface
from flow360_schema.models.entity_info import GeometryEntityInfo
from flow360_schema.models.simulation.outputs.outputs import ForceOutput

HERE = pathlib.Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
OUTPUT = HERE / "simulation.json"
TARGET_PATCH = HERE / "variants" / "target-uniform.patch.json"
EXPRESSION_PATCH = HERE / "variants" / "target-expression.patch.json"
RESTART_PATCH = HERE / "variants" / "target-modified-restart.patch.json"


def initial_condition(mode: str):
    if mode in {"source", "target"}:
        return fl.NavierStokesInitialCondition(rho="rho", u="u", v="v", w="w", p="p")
    if mode == "expression":
        return fl.NavierStokesInitialCondition(
            constants={"wakeDeficit": "0.15", "wakeX": "0.85", "wakeZ": "0.0", "wakeR2": "0.09"},
            rho="rho",
            u="u * (1 - wakeDeficit * exp(-((x-wakeX)*(x-wakeX) + (z-wakeZ)*(z-wakeZ))/wakeR2))",
            v="v",
            w="w",
            p="p",
        )
    return fl.NavierStokesModifiedRestartSolution(
        constants={"deltaAlpha": "0.06981317008"},
        rho="rho",
        u="cos(deltaAlpha) * u - sin(deltaAlpha) * w",
        v="v",
        w="sin(deltaAlpha) * u + cos(deltaAlpha) * w",
        p="p",
    )


def build(mode: Literal["source", "target", "expression", "restart"]) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    vane = Surface(
        name="vane",
        private_attribute_id="17000000-0000-4000-8000-000000001701",
        private_attribute_tag_key="groupName",
        private_attribute_sub_components=[f"vane0001_face{i:04d}" for i in range(1, 11)],
    )
    with fl.SI_unit_system:
        center_slice = fl.Slice(
            name="Midspan initialization audit plane",
            normal=(0, 1, 0),
            origin=(0.5, 0.125, 0) * fl.u.m,
            private_attribute_id="17000000-0000-4000-8000-000000001702",
        )
        farfield = GhostSphere(name="farfield", private_attribute_id="farfield", center=[0, 0, 0], maxRadius=100)
        info = GeometryEntityInfo(
            faceIDs=[*vane.private_attribute_sub_components],
            faceAttributeNames=["groupName"],
            groupedFaces=[[vane]],
            face_group_tag="groupName",
            global_bounding_box=[[0, 0, -0.045], [1, 0.25, 0.09]],
            ghost_entities=[farfield],
            draft_entities=[center_slice],
        )
        alpha = 8 if mode == "source" else 12
        wall = fl.Wall(name="Continuation vane wall", surfaces=[vane], private_attribute_id="17000000-0000-4000-8000-000000001713")
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(surface_max_edge_length=0.04 * fl.u.m, boundary_layer_first_layer_thickness=0.00003 * fl.u.m, boundary_layer_growth_rate=1.18, volume_edge_growth_rate=1.15),
                refinements=[
                    fl.SurfaceRefinement(name="Vane curvature resolution", faces=[vane], max_edge_length=0.02 * fl.u.m),
                    fl.BoundaryLayer(name="Vane wall layers", faces=[vane], first_layer_thickness=0.00003 * fl.u.m, growth_rate=1.18),
                ],
                volume_zones=[fl.AutomatedFarfield(name="Continuation farfield", relative_size=50)],
            ),
            reference_geometry=fl.ReferenceGeometry(area=0.25 * fl.u.m**2, moment_center=(0.5, 0.125, 0) * fl.u.m, moment_length=1.0 * fl.u.m),
            operating_condition=fl.AerospaceCondition.from_mach(mach=0.30, alpha=alpha * fl.u.deg),
            time_stepping=fl.Steady(max_steps=1600),
            models=[
                fl.Fluid(initial_condition=initial_condition(mode), turbulence_model_solver=fl.KOmegaSST(), private_attribute_id="17000000-0000-4000-8000-000000001711"),
                fl.Freestream(name="Subsonic approach flow", surfaces=[farfield], turbulence_quantities=fl.TurbulenceQuantities(turbulent_intensity=0.005, turbulent_length_scale=0.01 * fl.u.m), private_attribute_id="17000000-0000-4000-8000-000000001712"),
                wall,
            ],
            outputs=[
                fl.SurfaceOutput(name="Initialization surface evidence", surfaces=[vane], output_fields=["Cp", "Cf", "yPlus"], private_attribute_id="17000000-0000-4000-8000-000000001714"),
                fl.SliceOutput(name="Initialization field evidence", slices=[center_slice], output_fields=["Mach", "velocity_m_per_s", "pressure_pa", "vorticityMagnitude"], private_attribute_id="17000000-0000-4000-8000-000000001715"),
                ForceOutput(name="Continuation load evidence", models=[wall], output_fields=["CL", "CD"], private_attribute_id="17000000-0000-4000-8000-000000001716"),
            ],
            private_attribute_asset_cache=AssetCache(project_length_unit=1 * fl.u.m, project_entity_info=info, use_inhouse_mesher=True),
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
        else:
            difference = merge_patch(source[key], value)
            if difference != {}:
                patch[key] = difference
    return patch


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source = build("source")
    artifacts = (
        (OUTPUT, json.dumps(source, indent=2, sort_keys=True) + "\n"),
        (TARGET_PATCH, json.dumps(merge_patch(source, build("target")), indent=2, sort_keys=True) + "\n"),
        (EXPRESSION_PATCH, json.dumps(merge_patch(source, build("expression")), indent=2, sort_keys=True) + "\n"),
        (RESTART_PATCH, json.dumps(merge_patch(source, build("restart")), indent=2, sort_keys=True) + "\n"),
    )
    if args.check:
        if any(not path.exists() or path.read_text() != content for path, content in artifacts):
            print("T17 artifacts are stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T17 source, cold-start, expression, and modified-restart artifacts are reproducible")
        return 0
    for path, content in artifacts:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    print("wrote T17 source and target initialization variants")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
