#!/usr/bin/env python3
"""Rebuild deterministic T16 recovery, accuracy, and Krylov artifacts."""

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
ACCURACY_PATCH = HERE / "variants" / "accuracy.patch.json"
KRYLOV_PATCH = HERE / "variants" / "krylov-slau2.patch.json"


def build(mode: Literal["recovery", "accuracy", "krylov"]) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    vane = Surface(
        name="vane",
        private_attribute_id="16000000-0000-4000-8000-000000001601",
        private_attribute_tag_key="groupName",
        private_attribute_sub_components=[f"vane0001_face{i:04d}" for i in range(1, 11)],
    )
    with fl.SI_unit_system:
        center_slice = fl.Slice(
            name="Midspan numerical-diagnostics plane",
            normal=(0, 1, 0),
            origin=(0.5, 0.125, 0) * fl.u.m,
            private_attribute_id="16000000-0000-4000-8000-000000001602",
        )
        wake = fl.Box(
            name="Adverse-gradient and wake zone",
            center=(0.9, 0.125, 0) * fl.u.m,
            size=(1.8, 0.25, 0.7) * fl.u.m,
            private_attribute_id="16000000-0000-4000-8000-000000001603",
        )
        farfield = GhostSphere(name="farfield", private_attribute_id="farfield", center=[0, 0, 0], maxRadius=100)
        info = GeometryEntityInfo(
            faceIDs=[*vane.private_attribute_sub_components],
            faceAttributeNames=["groupName"],
            groupedFaces=[[vane]],
            face_group_tag="groupName",
            global_bounding_box=[[0, 0, -0.045], [1, 0.25, 0.09]],
            ghost_entities=[farfield],
            draft_entities=[center_slice, wake],
        )
        if mode == "recovery":
            navier_stokes = fl.NavierStokesSolver(
                absolute_tolerance=1e-10,
                relative_tolerance=0,
                order_of_accuracy=1,
                equation_evaluation_frequency=1,
                update_jacobian_frequency=1,
                CFL_multiplier=0.25,
                kappa_MUSCL=-1,
                limit_velocity=False,
                limit_pressure_density=False,
                linear_solver=fl.LinearSolver(max_iterations=30, absolute_tolerance=1e-12),
                riemann_solver=fl.RoeFlux(numerical_dissipation_factor=1.0, low_mach_preconditioner=True, low_mach_preconditioner_threshold=0.30),
            )
        elif mode == "accuracy":
            navier_stokes = fl.NavierStokesSolver(
                absolute_tolerance=1e-10,
                relative_tolerance=0,
                order_of_accuracy=2,
                equation_evaluation_frequency=1,
                update_jacobian_frequency=1,
                CFL_multiplier=1.0,
                kappa_MUSCL=-1,
                limit_velocity=False,
                limit_pressure_density=False,
                linear_solver=fl.LinearSolver(max_iterations=30, relative_tolerance=0.1),
                riemann_solver=fl.RoeFlux(numerical_dissipation_factor=1.0, low_mach_preconditioner=True, low_mach_preconditioner_threshold=0.30),
            )
        else:
            navier_stokes = fl.NavierStokesSolver(
                absolute_tolerance=1e-10,
                relative_tolerance=0,
                order_of_accuracy=2,
                CFL_multiplier=1.0,
                kappa_MUSCL=-0.33,
                limit_velocity=False,
                limit_pressure_density=False,
                linear_solver=fl.KrylovLinearSolver(max_iterations=15, max_preconditioner_iterations=25, relative_tolerance=0.05),
                line_search=fl.LineSearch(residual_growth_threshold=0.85, max_residual_growth=1.1, activation_step=100),
                riemann_solver=fl.SLAU2Flux(jacobian="Roe"),
            )
        wall = fl.Wall(name="Loaded vane wall", surfaces=[vane], private_attribute_id="16000000-0000-4000-8000-000000001613")
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(surface_max_edge_length=0.04 * fl.u.m, boundary_layer_first_layer_thickness=0.00003 * fl.u.m, boundary_layer_growth_rate=1.18, volume_edge_growth_rate=1.15),
                refinements=[
                    fl.SurfaceRefinement(name="Vane curvature resolution", faces=[vane], max_edge_length=0.02 * fl.u.m),
                    fl.BoundaryLayer(name="Vane wall layers", faces=[vane], first_layer_thickness=0.00003 * fl.u.m, growth_rate=1.18),
                    fl.UniformRefinement(name="Adverse-gradient and wake resolution", entities=[wake], spacing=0.015625 * fl.u.m),
                ],
                volume_zones=[fl.AutomatedFarfield(name="Loaded-vane farfield", relative_size=50)],
            ),
            reference_geometry=fl.ReferenceGeometry(area=0.25 * fl.u.m**2, moment_center=(0.5, 0.125, 0) * fl.u.m, moment_length=1.0 * fl.u.m),
            operating_condition=fl.AerospaceCondition.from_mach(mach=0.30, alpha=12 * fl.u.deg),
            time_stepping=fl.Steady(max_steps=1800),
            models=[
                fl.Fluid(navier_stokes_solver=navier_stokes, turbulence_model_solver=fl.KOmegaSST(), private_attribute_id="16000000-0000-4000-8000-000000001611"),
                fl.Freestream(name="Subsonic approach flow", surfaces=[farfield], turbulence_quantities=fl.TurbulenceQuantities(turbulent_intensity=0.005, turbulent_length_scale=0.01 * fl.u.m), private_attribute_id="16000000-0000-4000-8000-000000001612"),
                wall,
            ],
            outputs=[
                fl.SurfaceOutput(name="Vane loading evidence", surfaces=[vane], output_fields=["Cp", "Cf", "CfVec", "yPlus", "wall_shear_stress_magnitude_pa"], private_attribute_id="16000000-0000-4000-8000-000000001614"),
                fl.SliceOutput(name="Local numerical-state evidence", slices=[center_slice], output_fields=["Mach", "velocity_m_per_s", "pressure_pa", "vorticityMagnitude", "mutRatio"], private_attribute_id="16000000-0000-4000-8000-000000001615"),
                ForceOutput(name="Vane force evidence", models=[wall], output_fields=["CL", "CD"], private_attribute_id="16000000-0000-4000-8000-000000001616"),
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
    recovery, accuracy, krylov = build("recovery"), build("accuracy"), build("krylov")
    artifacts = (
        (OUTPUT, json.dumps(recovery, indent=2, sort_keys=True) + "\n"),
        (ACCURACY_PATCH, json.dumps(merge_patch(recovery, accuracy), indent=2, sort_keys=True) + "\n"),
        (KRYLOV_PATCH, json.dumps(merge_patch(recovery, krylov), indent=2, sort_keys=True) + "\n"),
    )
    if args.check:
        if any(not path.exists() or path.read_text() != content for path, content in artifacts):
            print("T16 artifacts are stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T16 recovery, accuracy, and Krylov/SLAU2 artifacts are reproducible")
        return 0
    for path, content in artifacts:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    print("wrote T16 recovery and accuracy/Krylov variants")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
