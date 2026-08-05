#!/usr/bin/env python3
"""Export a deterministic public feature registry from Flow360's JSON schema."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import pathlib
import sys
from typing import Any, Iterable

ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "tutorials" / "flow360-version.json"
CAPABILITIES_FILE = ROOT / "tutorials" / "capabilities.json"
REGISTRY_FILE = ROOT / "tutorials" / "feature-registry.json"


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def variants(node: dict[str, Any]) -> Iterable[tuple[str, str]]:
    for keyword in ("oneOf", "anyOf"):
        meaningful = [branch for branch in node.get(keyword, []) if branch.get("type") != "null"]
        if len(meaningful) < 2:
            continue
        for branch in meaningful:
            if "$ref" in branch:
                yield keyword, branch["$ref"].rsplit("/", 1)[-1]
            elif "const" in branch:
                yield keyword, str(branch["const"])
            elif "enum" in branch:
                yield keyword, "|".join(str(item) for item in branch["enum"])
            else:
                yield keyword, branch.get("title", branch.get("type", "anonymous"))


def schema_features(schema: dict[str, Any]) -> list[dict[str, Any]]:
    definitions = {"SimulationParams": schema, **schema.get("$defs", {})}
    features: dict[str, dict[str, Any]] = {}

    def add(value: dict[str, Any]) -> None:
        existing = features.get(value["id"])
        if existing and "values" in value:
            existing["values"] = sorted(set(existing["values"] + value["values"]), key=str)
            return
        features[value["id"]] = value

    def walk(owner: str, path: str, node: dict[str, Any]) -> None:
        if "enum" in node:
            add({"id": f"schema:enum:{path}", "kind": "enum_family", "owner": owner, "path": path, "values": node["enum"]})
        for keyword, variant in variants(node):
            add({"id": f"schema:variant:{path}={variant}", "kind": "union_variant", "owner": owner, "path": path, "variant": variant, "union": keyword})
        for field, field_schema in sorted(node.get("properties", {}).items()):
            field_path = f"{path}.{field}"
            add({"id": f"schema:field:{field_path}", "kind": "schema_field", "owner": owner, "path": field_path})
            walk(owner, field_path, field_schema)
        if isinstance(node.get("items"), dict):
            walk(owner, f"{path}[]", node["items"])
        if isinstance(node.get("additionalProperties"), dict):
            walk(owner, f"{path}{{}}", node["additionalProperties"])
        for keyword in ("oneOf", "anyOf", "allOf"):
            for branch in node.get(keyword, []):
                if isinstance(branch, dict) and "$ref" not in branch:
                    walk(owner, path, branch)

    for owner, definition in sorted(definitions.items()):
        add({"id": f"schema:type:{owner}", "kind": "schema_type", "owner": owner, "path": owner})
        walk(owner, owner, definition)
    return list(features.values())


def build_registry() -> dict[str, Any]:
    import flow360 as fl

    pinned = json.loads(VERSION_FILE.read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise SystemExit(f"installed {pinned['package']} {installed}, expected {pinned['package_version']}")
    schema = fl.SimulationParams.model_json_schema()
    features = schema_features(schema)
    capabilities = json.loads(CAPABILITIES_FILE.read_text())
    for plural in ("workflows", "results"):
        kind = plural[:-1]
        for capability in capabilities[plural]:
            features.append({"id": f"{kind}:{capability['id']}", "kind": kind, "owner": kind, "path": capability["id"], "title": capability["title"]})
    features.sort(key=lambda item: item["id"])
    return {
        "registry_version": 1,
        "source": {
            "package": pinned["package"],
            "package_version": installed,
            "api_version": pinned["api_version"],
            "schema_root": "flow360.SimulationParams",
            "schema_sha256": hashlib.sha256(canonical_json(schema).encode()).hexdigest(),
        },
        "features": features,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if the committed registry differs")
    args = parser.parse_args()
    rendered = json.dumps(build_registry(), indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not REGISTRY_FILE.exists() or REGISTRY_FILE.read_text() != rendered:
            print("Flow360 feature registry is stale; run scripts/export_flow360_features.py", file=sys.stderr)
            return 1
        print("Flow360 feature registry matches the pinned package")
        return 0
    REGISTRY_FILE.write_text(rendered)
    print(f"wrote {REGISTRY_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
