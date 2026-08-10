#!/usr/bin/env python3
"""Rebuild deterministic T02 wind-tunnel similarity artifacts."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import pathlib
import sys
from typing import Any

import flow360 as fl

HERE = pathlib.Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
OUTPUT = HERE / "simulation.json"
PATCH = HERE / "variants" / "match-reynolds.patch.json"
SOURCE = REPOSITORY / "tutorials" / "T01-first-lift-drag" / "simulation.json"


def operating_condition(match_reynolds: bool) -> dict[str, Any]:
    with fl.SI_unit_system:
        if match_reynolds:
            condition = fl.AerospaceCondition.from_mach_reynolds(
                mach=0.18,
                reynolds_mesh_unit=2.5e6,
                project_length_unit=1 * fl.u.m,
                temperature=288.15 * fl.u.K,
                alpha=4 * fl.u.deg,
                beta=0 * fl.u.deg,
            )
        else:
            condition = fl.AerospaceCondition.from_mach(
                mach=0.18,
                thermal_state=fl.ThermalState(),
                alpha=4 * fl.u.deg,
                beta=0 * fl.u.deg,
            )
    return json.loads(condition.model_dump_json(exclude_none=True))


def build(match_reynolds: bool) -> dict[str, Any]:
    pinned = json.loads((REPOSITORY / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed flow360 {installed}, expected {pinned['package_version']}")
    params = json.loads(SOURCE.read_text())
    params["operating_condition"] = operating_condition(match_reynolds)
    return params


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
            print("T02 artifacts are stale; run build_simulation.py", file=sys.stderr)
            return 1
        print("T02 simulation and Reynolds-matched variant are reproducible")
        return 0
    OUTPUT.write_text(rendered)
    PATCH.write_text(patch_rendered)
    print("wrote T02 simulation.json and match-reynolds.patch.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
