#!/usr/bin/env python3
"""Rebuild deterministic T14 SA and k-omega SST artifacts."""

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
from flow360_schema.models.simulation.outputs.outputs import ForceOutput

HERE = pathlib.Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
OUTPUT = HERE / "simulation.json"
PATCH = HERE / "variants" / "k-omega-sst.patch.json"


def build(use_sst: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    body = Surface(name="body", private_attribute_id="00000000-0000-4000-8000-000000001401", private_attribute_tag_key="groupName", private_attribute_sub_components=[f"body0001_face{i:04d}" for i in range(1, 11)])
    with fl.SI_unit_system:
        center_slice = fl.Slice(name="Wake center plane", normal=(0, 1, 0), origin=(0, 0, 0) * fl.u.m, private_attribute_id="14000000-0000-4000-8000-000000001401")
        wake = fl.Box(name="Separated wake corridor", center=(3.0, 0, 0) * fl.u.m, size=(7.0, 3.0, 3.0) * fl.u.m, private_attribute_id="14000000-0000-4000-8000-000000001402")
        farfield = GhostSphere(name="farfield", private_attribute_id="farfield", center=[0, 0, 0], maxRadius=100)
        info = GeometryEntityInfo(faceIDs=[*body.private_attribute_sub_components], faceAttributeNames=["groupName"], groupedFaces=[[body]], face_group_tag="groupName", global_bounding_box=[[-1.5, -0.6, -0.5], [1.5, 0.6, 0.7]], ghost_entities=[farfield], draft_entities=[center_slice, wake])
        turbulence_solver = fl.KOmegaSST() if use_sst else fl.SpalartAllmaras()
        freestream_quantities = (fl.TurbulenceQuantities(turbulent_intensity=0.005, turbulent_length_scale=0.01 * fl.u.m) if use_sst else fl.TurbulenceQuantities(modified_viscosity_ratio=70))
        wall = fl.Wall(name="Rear-step body wall", surfaces=[body], use_wall_function=fl.WallFunction(), private_attribute_id="14000000-0000-4000-8000-000000001413")
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(surface_max_edge_length=0.12 * fl.u.m, boundary_layer_first_layer_thickness=0.00025 * fl.u.m, boundary_layer_growth_rate=1.2, volume_edge_growth_rate=1.15),
                refinements=[fl.SurfaceRefinement(name="Body edge resolution", faces=[body], max_edge_length=0.06 * fl.u.m), fl.BoundaryLayer(name="Body wall layers", faces=[body], first_layer_thickness=0.00025 * fl.u.m, growth_rate=1.2), fl.UniformRefinement(name="Separated wake resolution", entities=[wake], spacing=0.0625 * fl.u.m)],
                volume_zones=[fl.AutomatedFarfield(name="Wind-tunnel farfield", relative_size=50)],
            ),
            reference_geometry=fl.ReferenceGeometry(area=1.44 * fl.u.m**2, moment_center=(0, 0, 0) * fl.u.m, moment_length=1.2 * fl.u.m),
            operating_condition=fl.AerospaceCondition(velocity_magnitude=30 * fl.u.m / fl.u.s),
            time_stepping=fl.Steady(max_steps=1500),
            models=[
                fl.Fluid(turbulence_model_solver=turbulence_solver, private_attribute_id="14000000-0000-4000-8000-000000001411"),
                fl.Freestream(name="Low-turbulence wind tunnel", surfaces=[farfield], turbulence_quantities=freestream_quantities, private_attribute_id="14000000-0000-4000-8000-000000001412"),
                wall,
            ],
            outputs=[
                fl.SurfaceOutput(name="Body separation evidence", surfaces=[body], output_fields=["Cp", "Cf", "CfVec", "yPlus", "wall_shear_stress_magnitude_pa"], private_attribute_id="14000000-0000-4000-8000-000000001414"),
                fl.SliceOutput(name="Wake turbulence evidence", slices=[center_slice], output_fields=["velocity_m_per_s", "pressure_pa", "vorticityMagnitude", "mut", "mutRatio"], private_attribute_id="14000000-0000-4000-8000-000000001415"),
                ForceOutput(name="Body drag evidence", models=[wall], output_fields=["CD"], private_attribute_id="14000000-0000-4000-8000-000000001416"),
            ],
            private_attribute_asset_cache=AssetCache(project_length_unit=1 * fl.u.m, project_entity_info=info, use_inhouse_mesher=True),
        )
    return json.loads(params.model_dump_json(exclude_none=True))


def merge_patch(source: Any, target: Any) -> Any:
    if not isinstance(source, dict) or not isinstance(target, dict): return target if source != target else {}
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
            print("T14 artifacts are stale; run build_simulation.py", file=sys.stderr); return 1
        print("T14 SA baseline and k-omega SST variant are reproducible"); return 0
    OUTPUT.write_text(rendered); PATCH.write_text(patched); print("wrote T14 simulation.json and k-omega SST variant"); return 0


if __name__ == "__main__": raise SystemExit(main())
