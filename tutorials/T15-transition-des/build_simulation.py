#!/usr/bin/env python3
"""Rebuild deterministic T15 fully turbulent, transition, and DDES artifacts."""

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
TRANSITION_PATCH = HERE / "variants" / "transition.patch.json"
DDES_PATCH = HERE / "variants" / "ddes.patch.json"


def surface(name: str, index: int, count: int) -> Surface:
    return Surface(
        name=name,
        private_attribute_id=f"15000000-0000-4000-8000-{index:012d}",
        private_attribute_tag_key="groupName",
        private_attribute_sub_components=[f"{name}_face{i:04d}" for i in range(1, count + 1)],
    )


def build(mode: Literal["rans", "transition", "ddes"]) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    main_wing = surface("mainWing", 1501, 8)
    slat = surface("slat", 1502, 7)
    flap = surface("flap", 1503, 7)
    aerodynamic_surfaces = [main_wing, slat, flap]
    with fl.SI_unit_system:
        center_slice = fl.Slice(name="Midspan separation plane", normal=(0, 1, 0), origin=(0.5, 0.15, 0) * fl.u.m, private_attribute_id="15000000-0000-4000-8000-000000001504")
        separated_zone = fl.Box(name="Separated shear-layer volume", center=(1.15, 0.15, 0) * fl.u.m, size=(2.4, 0.30, 0.9) * fl.u.m, private_attribute_id="15000000-0000-4000-8000-000000001505")
        farfield = GhostSphere(name="farfield", private_attribute_id="farfield", center=[0, 0, 0], maxRadius=100)
        info = GeometryEntityInfo(
            faceIDs=[component for item in aerodynamic_surfaces for component in item.private_attribute_sub_components],
            faceAttributeNames=["groupName"], groupedFaces=[aerodynamic_surfaces], face_group_tag="groupName",
            global_bounding_box=[[-0.08, 0, -0.185], [1.20, 0.30, 0.08]], ghost_entities=[farfield],
            draft_entities=[center_slice, separated_zone],
        )
        hybrid = fl.DetachedEddySimulation(shielding_function="DDES", grid_size_for_LES="shearLayerAdapted") if mode == "ddes" else None
        transition = fl.TransitionModelSolver(turbulence_intensity_percent=0.10) if mode == "transition" else fl.NoneSolver()
        time_stepping = fl.Unsteady(steps=5000, step_size=0.0002 * fl.u.s, max_pseudo_steps=30) if mode == "ddes" else fl.Steady(max_steps=2000)
        fluid = fl.Fluid(
            turbulence_model_solver=fl.KOmegaSST(hybrid_model=hybrid),
            transition_model_solver=transition,
            private_attribute_id="15000000-0000-4000-8000-000000001511",
        )
        wall = fl.Wall(name="High-lift element walls", surfaces=aerodynamic_surfaces, private_attribute_id="15000000-0000-4000-8000-000000001513")
        slice_fields = ["velocity_m_per_s", "pressure_pa", "vorticityMagnitude", "qcriterion", "mutRatio", "wallDistance"]
        if mode == "transition":
            slice_fields.append("solutionTransition")
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(surface_max_edge_length=0.04 * fl.u.m, boundary_layer_first_layer_thickness=0.000015 * fl.u.m, boundary_layer_growth_rate=1.18, volume_edge_growth_rate=1.15),
                refinements=[
                    fl.SurfaceRefinement(name="High-lift surface resolution", faces=aerodynamic_surfaces, max_edge_length=0.02 * fl.u.m),
                    fl.BoundaryLayer(name="Wall-resolved element layers", faces=aerodynamic_surfaces, first_layer_thickness=0.000015 * fl.u.m, growth_rate=1.18),
                    fl.UniformRefinement(name="Three-dimensional separated shear layer", entities=[separated_zone], spacing=0.015625 * fl.u.m),
                ],
                volume_zones=[fl.AutomatedFarfield(name="High-angle farfield", relative_size=60)],
            ),
            reference_geometry=fl.ReferenceGeometry(area=0.30 * fl.u.m**2, moment_center=(0.5, 0.15, 0) * fl.u.m, moment_length=1.0 * fl.u.m),
            operating_condition=fl.AerospaceCondition(velocity_magnitude=50 * fl.u.m / fl.u.s, alpha=16 * fl.u.deg),
            time_stepping=time_stepping,
            models=[
                fluid,
                fl.Freestream(name="Low-turbulence approach flow", surfaces=[farfield], turbulence_quantities=fl.TurbulenceQuantities(turbulent_intensity=0.001, turbulent_length_scale=0.01 * fl.u.m), private_attribute_id="15000000-0000-4000-8000-000000001512"),
                wall,
            ],
            outputs=[
                fl.SurfaceOutput(name="Element loading and transition evidence", surfaces=aerodynamic_surfaces, output_fields=["Cp", "Cf", "CfVec", "yPlus", "wall_shear_stress_magnitude_pa"], private_attribute_id="15000000-0000-4000-8000-000000001514"),
                fl.SliceOutput(name="Separated-flow structure evidence", slices=[center_slice], output_fields=slice_fields, private_attribute_id="15000000-0000-4000-8000-000000001515"),
                ForceOutput(name="High-lift force evidence", models=[wall], output_fields=["CL", "CD"], private_attribute_id="15000000-0000-4000-8000-000000001516"),
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
    baseline = build("rans")
    transition = build("transition")
    ddes = build("ddes")
    artifacts = (
        (OUTPUT, json.dumps(baseline, indent=2, sort_keys=True) + "\n"),
        (TRANSITION_PATCH, json.dumps(merge_patch(baseline, transition), indent=2, sort_keys=True) + "\n"),
        (DDES_PATCH, json.dumps(merge_patch(baseline, ddes), indent=2, sort_keys=True) + "\n"),
    )
    if args.check:
        if any(not path.exists() or path.read_text() != content for path, content in artifacts):
            print("T15 artifacts are stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T15 RANS, transition, and DDES artifacts are reproducible")
        return 0
    for path, content in artifacts:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    print("wrote T15 baseline and transition/DDES variants")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
