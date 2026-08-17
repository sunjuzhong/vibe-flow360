#!/usr/bin/env python3
"""Rebuild deterministic T10 global-only and feature-aware snappy artifacts."""
from __future__ import annotations

import argparse, importlib.metadata, json, pathlib, sys
from typing import Any
import flow360 as fl
from flow360_schema.framework.param_utils import AssetCache
from flow360_schema.models.entities.geometry_entities import GeometryBodyGroup
from flow360_schema.models.entities.surface_entities import Surface
from flow360_schema.models.entity_info import GeometryEntityInfo

HERE = pathlib.Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
OUTPUT = HERE / "simulation.json"
PATCH = HERE / "variants" / "feature-aware.patch.json"

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

def build(feature_aware: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]: raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")
    body = GeometryBodyGroup(name="heatSink", private_attribute_id="a0000000-0000-4000-8000-000000001001", private_attribute_tag_key="bodyName", private_attribute_sub_components=["body0001"])
    base = Surface(name="base", private_attribute_id="a0000000-0000-4000-8000-000000001002", private_attribute_tag_key="faceName", private_attribute_sub_components=[f"body0001_face{i:04d}" for i in range(1, 7)])
    fins = Surface(name="fins", private_attribute_id="a0000000-0000-4000-8000-000000001003", private_attribute_tag_key="faceName", private_attribute_sub_components=[f"body0001_face{i:04d}" for i in range(7, 43)])
    info = GeometryEntityInfo(bodyIDs=["body0001"], bodyAttributeNames=["bodyName"], groupedBodies=[[body]], body_group_tag="bodyName", faceIDs=[*base.private_attribute_sub_components, *fins.private_attribute_sub_components], faceAttributeNames=["faceName"], groupedFaces=[[base, fins]], face_group_tag="faceName", global_bounding_box=[[0, 0, 0], [0.16, 0.10, 0.055]])
    with fl.SI_unit_system:
        refinements = None
        if feature_aware:
            refinements = [
                fl.snappy.BodyRefinement(bodies=[body], min_spacing=0.0009765625 * fl.u.m, max_spacing=0.00390625 * fl.u.m, gap_resolution=0.002 * fl.u.m),
                fl.snappy.RegionRefinement(regions=[fins], min_spacing=0.0009765625 * fl.u.m, max_spacing=0.001953125 * fl.u.m, proximity_spacing=0.00048828125 * fl.u.m),
                fl.snappy.SurfaceEdgeRefinement(entities=[body], spacing=[0.0009765625, 0.001953125] * fl.u.m, distances=[0.003, 0.008] * fl.u.m, included_angle=120 * fl.u.deg, retain_on_smoothing=True),
            ]
        surface = fl.snappy.SurfaceMeshingParams(
            defaults=fl.snappy.SurfaceMeshingDefaults(min_spacing=0.001953125 * fl.u.m, max_spacing=0.015625 * fl.u.m, gap_resolution=0.012 * fl.u.m),
            refinements=refinements,
            castellated_mesh_controls=fl.snappy.CastellatedMeshControls(resolve_feature_angle=25 * fl.u.deg, n_cells_between_levels=2 if feature_aware else 1, min_refinement_cells=8),
            snap_controls=fl.snappy.SnapControls(n_smooth_patch=4, tolerance=1.5, n_solve_iter=40, n_relax_iter=6, n_feature_snap_iter=20, multi_region_feature_snap=True, strict_region_snap=feature_aware),
            smooth_controls=fl.snappy.SmoothControls(lambda_factor=0.65, mu_factor=0.70, iterations=6),
            quality_metrics=fl.snappy.QualityMetrics(max_non_ortho=70 * fl.u.deg, max_boundary_skewness=12 * fl.u.deg, max_internal_skewness=35 * fl.u.deg, max_concave=45 * fl.u.deg, min_tet_quality=1e-9, n_smooth_scale=4, error_reduction=0.75),
        )
        params = fl.SimulationParams(meshing=fl.ModularMeshingWorkflow(surface_meshing=surface, zones=[fl.AutomatedFarfield(relative_size=20)]), private_attribute_asset_cache=AssetCache(project_length_unit=1 * fl.u.m, project_entity_info=info, use_inhouse_mesher=False))
    return json.loads(params.model_dump_json(exclude_none=True))

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--check", action="store_true"); args = parser.parse_args()
    baseline, variant = build(False), build(True)
    rendered = json.dumps(baseline, indent=2, sort_keys=True) + "\n"; patched = json.dumps(merge_patch(baseline, variant), indent=2, sort_keys=True) + "\n"
    if args.check:
        if any(not p.exists() or p.read_text() != c for p, c in ((OUTPUT, rendered), (PATCH, patched))): print("T10 artifacts are stale; run build_simulation.py", file=sys.stderr); return 1
        print("T10 simulation and feature-aware variant are reproducible"); return 0
    OUTPUT.write_text(rendered); PATCH.write_text(patched); print("wrote T10 simulation.json and feature-aware variant"); return 0
if __name__ == "__main__": raise SystemExit(main())
