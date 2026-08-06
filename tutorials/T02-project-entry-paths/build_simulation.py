#!/usr/bin/env python3
"""Rebuild T02's deterministic VolumeMesh-to-Case teaching artifact."""
from __future__ import annotations
import argparse, json, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUT = HERE / "simulation.json"

def build():
    return json.loads((ROOT / "tutorials/T01-first-lift-drag/simulation.json").read_text())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build(), indent=2, sort_keys=True) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered:
            print("simulation.json is stale", file=sys.stderr); return 1
        print("T02 simulation.json is reproducible"); return 0
    OUTPUT.write_text(rendered); return 0

if __name__ == "__main__": raise SystemExit(main())
