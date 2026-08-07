#!/usr/bin/env python3
"""Rebuild deterministic T04 explicit-edge and Geometry AI artifacts."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import pathlib
import sys
from typing import Any

import flow360 as fl
from flow360_schema.framework.param_utils import AssetCache
from flow360_schema.models.entities.geometry_entities import Edge
from flow360_schema.models.entities.surface_entities import Surface
from flow360_schema.models.entity_info import GeometryEntityInfo


HERE = pathlib.Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
OUTPUT = HERE / "simulation.json"
PATCH = HERE / "variants" / "geometry-aware.patch.json"


def surface(name: str, index: int, components: list[str]) -> Surface:
    return Surface(
        name=name,
        private_attribute_id=f"00000000-0000-4000-8000-{index:012d}",
        private_attribute_tag_key="faceName",
        private_attribute_sub_components=components,
    )


def edge(name: str, index: int, components: list[str]) -> Edge:
    return Edge(
        name=name,
        private_attribute_id=f"10000000-0000-4000-8000-{index:012d}",
        private_attribute_tag_key="edgeName",
        private_attribute_sub_components=components,
    )


def entities():
    wing = surface("wing", 201, ["wing-face-1", "wing-face-2"])
    flap = surface("flap", 202, ["flap-face-1", "flap-face-2"])
    slat = surface("slat", 203, ["slat-face-1", "slat-face-2"])
    symmetry = surface("symmetry", 204, ["symmetry-face-1", "symmetry-face-2"])
    leading = edge("leadingEdges", 301, ["wing-leading", "flap-leading", "slat-leading"])
    trailing = edge("trailingEdges", 302, ["wing-trailing", "flap-trailing", "slat-trailing"])
    gaps = edge("gapEdges", 303, ["slat-gap", "flap-gap"])
    symmetry_edges = edge("symmetry", 304, ["symmetry-edge-1", "symmetry-edge-2"])
    info = GeometryEntityInfo(
        faceIDs=[component for item in [wing, flap, slat, symmetry] for component in item.private_attribute_sub_components],
        faceAttributeNames=["faceName"],
        groupedFaces=[[wing, flap, slat, symmetry]],
        edgeIDs=[component for item in [leading, trailing, gaps, symmetry_edges] for component in item.private_attribute_sub_components],
        edgeAttributeNames=["edgeName"],
        groupedEdges=[[leading, trailing, gaps, symmetry_edges]],
        face_group_tag="faceName",
        edge_group_tag="edgeName",
        global_bounding_box=[[-0.2, 0.0, -0.22], [1.2, 0.01, 0.25]],
    )
    return wing, flap, slat, symmetry, leading, trailing, gaps, symmetry_edges, info


def build(geometry_ai: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")
    wing, flap, slat, symmetry, leading, trailing, gaps, symmetry_edges, info = entities()
    with fl.SI_unit_system:
        if geometry_ai:
            defaults = fl.MeshingDefaults(
                geometry_accuracy=0.0005,
                surface_max_edge_length=0.05,
                curvature_resolution_angle=12 * fl.u.deg,
                boundary_layer_first_layer_thickness=4.9536767e-6,
                boundary_layer_growth_rate=1.17,
            )
            refinements = [
                fl.GeometryRefinement(
                    name="Preserve slat and flap passages",
                    faces=[wing, flap, slat],
                    geometry_accuracy=0.00035,
                    preserve_thin_geometry=True,
                    sealing_size=0.0,
                    min_passage_size=0.0015,
                ),
                fl.PassiveSpacing(name="Keep symmetry spacing", faces=[symmetry], type="projected"),
            ]
        else:
            defaults = fl.MeshingDefaults(
                surface_max_edge_length=0.05,
                curvature_resolution_angle=12 * fl.u.deg,
                surface_edge_growth_rate=1.17,
                boundary_layer_first_layer_thickness=4.9536767e-6,
                boundary_layer_growth_rate=1.17,
            )
            refinements = [
                fl.SurfaceRefinement(name="Main element", faces=[wing], max_edge_length=0.04),
                fl.SurfaceRefinement(name="Slat and flap", faces=[slat, flap], max_edge_length=0.025),
                fl.SurfaceEdgeRefinement(name="Leading-edge angle", edges=[leading], method=fl.AngleBasedRefinement(value=8 * fl.u.deg)),
                fl.SurfaceEdgeRefinement(name="Trailing-edge height", edges=[trailing], method=fl.HeightBasedRefinement(value=0.0007)),
                fl.SurfaceEdgeRefinement(name="Gap aspect ratio", edges=[gaps], method=fl.AspectRatioBasedRefinement(value=10)),
                fl.SurfaceEdgeRefinement(name="Symmetry projection", edges=[symmetry_edges], method=fl.ProjectAnisoSpacing()),
                fl.PassiveSpacing(name="Keep symmetry spacing", faces=[symmetry], type="projected"),
            ]
        params = fl.SimulationParams(
            meshing=fl.MeshingParams(
                defaults=defaults,
                refinement_factor=1.35,
                gap_treatment_strength=0.5,
                refinements=refinements,
                volume_zones=[fl.AutomatedFarfield(method="quasi-3d")],
            ),
            private_attribute_asset_cache=AssetCache(
                project_length_unit=1 * fl.u.m,
                project_entity_info=info,
                use_inhouse_mesher=not geometry_ai,
                use_geometry_AI=geometry_ai,
                cad_importer_version="v2" if geometry_ai else "v1",
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
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered or not PATCH.exists() or PATCH.read_text() != patch_rendered:
            print("T04 artifacts are stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T04 simulation and variant are reproducible")
        return 0
    OUTPUT.write_text(rendered)
    PATCH.write_text(patch_rendered)
    print("wrote T04 simulation.json and geometry-aware.patch.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
