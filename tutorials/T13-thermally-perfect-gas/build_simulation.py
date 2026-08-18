#!/usr/bin/env python3
"""Rebuild deterministic T13 hot-gas probe artifacts."""

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
PATCH = HERE / "variants" / "nasa9-mixture.patch.json"

N2_LOW = [2.21037150e04, -3.81846182e02, 6.08273836, -8.53091441e-03, 1.38464610e-05, -9.62579362e-09, 2.51970561e-12, -1.04396091e03, -1.04765254e01]
N2_HIGH = [5.87712406e05, -2.23924969e03, 6.06694922, -6.13968556e-04, 1.49180673e-07, -1.92309843e-11, 1.06194817e-15, 1.28320618e04, -1.58637463e01]
O2_LOW = [-3.42556342e04, 4.84700097e02, 1.119010961, 4.29388924e-03, -6.83630052e-07, -2.0233727e-09, 1.039040018e-12, -3.39145487e03, 1.84969947e01]
O2_HIGH = [-1.037939022e06, 2.344830282e03, 1.819732036, 1.267847582e-03, -2.188067988e-07, 2.053719572e-11, -8.19346705e-16, -1.689010929e04, 1.738716506e01]


def nasa9(low: list[float], high: list[float]) -> fl.NASA9Coefficients:
    return fl.NASA9Coefficients(temperature_ranges=[
        fl.NASA9CoefficientSet(temperature_range_min=200 * fl.u.K, temperature_range_max=1000 * fl.u.K, coefficients=low),
        fl.NASA9CoefficientSet(temperature_range_min=1000 * fl.u.K, temperature_range_max=6000 * fl.u.K, coefficients=high),
    ])


def material(nasa9_enabled: bool) -> fl.Air:
    viscosity = fl.Sutherland(reference_viscosity=1.716e-5 * fl.u.Pa * fl.u.s, reference_temperature=273.15 * fl.u.K, effective_temperature=110.4 * fl.u.K)
    if not nasa9_enabled:
        return fl.Air(name="Constant-gamma air", dynamic_viscosity=viscosity)
    return fl.Air(name="Frozen N2-O2 air", dynamic_viscosity=viscosity, thermally_perfect_gas=fl.ThermallyPerfectGas(species=[
        fl.FrozenSpecies(name="N2", nasa_9_coefficients=nasa9(N2_LOW, N2_HIGH), mass_fraction=0.767),
        fl.FrozenSpecies(name="O2", nasa_9_coefficients=nasa9(O2_LOW, O2_HIGH), mass_fraction=0.233),
    ]))


def build(nasa9_enabled: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")

    probe = Surface(name="probe", private_attribute_id="00000000-0000-4000-8000-000000001301", private_attribute_tag_key="groupName", private_attribute_sub_components=[f"body0001_face000{i}" for i in range(1, 4)])
    with fl.SI_unit_system:
        gas = material(nasa9_enabled)
        center_slice = fl.Slice(name="Probe center plane", normal=(0, 1, 0), origin=(0, 0, 0) * fl.u.m, private_attribute_id="13000000-0000-4000-8000-000000001301")
        farfield = GhostSphere(name="farfield", private_attribute_id="farfield", center=[0, 0, 0], maxRadius=100)
        info = GeometryEntityInfo(faceIDs=[*probe.private_attribute_sub_components], faceAttributeNames=["groupName"], groupedFaces=[[probe]], face_group_tag="groupName", global_bounding_box=[[-0.025, -0.1, -0.025], [0.025, 0.1, 0.025]], ghost_entities=[farfield], draft_entities=[center_slice])
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=fl.MeshingDefaults(surface_max_edge_length=0.008 * fl.u.m, boundary_layer_first_layer_thickness=0.00002 * fl.u.m, boundary_layer_growth_rate=1.2, volume_edge_growth_rate=1.15),
                refinements=[fl.SurfaceRefinement(name="Probe curvature", faces=[probe], max_edge_length=0.004 * fl.u.m), fl.BoundaryLayer(name="Probe thermal boundary layer", faces=[probe], first_layer_thickness=0.00002 * fl.u.m, growth_rate=1.2)],
                volume_zones=[fl.AutomatedFarfield(name="Hot-gas farfield", relative_size=50)],
            ),
            reference_geometry=fl.ReferenceGeometry(area=0.01 * fl.u.m**2, moment_center=(0, 0, 0) * fl.u.m, moment_length=0.05 * fl.u.m),
            operating_condition=fl.GenericReferenceCondition(velocity_magnitude=900 * fl.u.m / fl.u.s, thermal_state=fl.ThermalState(temperature=1800 * fl.u.K, density=0.19610206574 * fl.u.kg / fl.u.m**3, material=gas)),
            time_stepping=fl.Steady(max_steps=2000),
            models=[
                fl.Fluid(navier_stokes_solver=fl.NavierStokesSolver(riemann_solver=fl.RoeFlux()), private_attribute_id="13000000-0000-4000-8000-000000001311"),
                fl.Freestream(name="1800 K exhaust stream", surfaces=[farfield], private_attribute_id="13000000-0000-4000-8000-000000001312"),
                fl.Wall(name="600 K isothermal probe", surfaces=[probe], use_wall_function=fl.WallFunction(), heat_spec=fl.Temperature(value=600 * fl.u.K), private_attribute_id="13000000-0000-4000-8000-000000001313"),
            ],
            outputs=[
                fl.SurfaceOutput(name="Probe aerothermal evidence", surfaces=[probe], output_fields=["Cp", "pressure_pa", "T", "heatFlux", "yPlus"], private_attribute_id="13000000-0000-4000-8000-000000001314"),
                fl.SliceOutput(name="Shock and thermal evidence", slices=[center_slice], output_fields=["Mach", "pressure_pa", "T", "velocity_m_per_s"], private_attribute_id="13000000-0000-4000-8000-000000001315"),
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
            print("T13 artifacts are stale; run build_simulation.py", file=sys.stderr); return 1
        print("T13 constant-gamma baseline and NASA-9 variant are reproducible"); return 0
    OUTPUT.write_text(rendered); PATCH.write_text(patched); print("wrote T13 simulation.json and NASA-9 mixture variant"); return 0


if __name__ == "__main__": raise SystemExit(main())
