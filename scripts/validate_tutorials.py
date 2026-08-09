#!/usr/bin/env python3
"""Validate tutorial contracts and Flow360 artifacts without cloud access."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import pathlib
import sys
from typing import Any

import yaml
from jsonschema import Draft202012Validator


REPORT_VERSION = 1


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def merge_patch(target: Any, patch: Any) -> Any:
    """Apply RFC 7396 JSON Merge Patch without mutating the inputs."""
    if not isinstance(patch, dict):
        return patch
    result = dict(target) if isinstance(target, dict) else {}
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = merge_patch(result.get(key), value)
    return result


def safe_path(root: pathlib.Path, tutorial_dir: pathlib.Path, relative: str) -> pathlib.Path:
    if pathlib.PurePosixPath(relative).is_absolute() or "\\" in relative:
        raise ValueError(f"path must be a portable relative path: {relative}")
    resolved = (tutorial_dir / relative).resolve()
    if not resolved.is_relative_to(tutorial_dir.resolve()):
        raise ValueError(f"path escapes tutorial directory: {relative}")
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError(f"path escapes repository: {relative}")
    return resolved


def load_yaml(path: pathlib.Path) -> Any:
    with path.open(encoding="utf-8") as stream:
        return yaml.safe_load(stream)


def validate_flow360(params: dict[str, Any], root_item_type: str, validation_level: str) -> tuple[list[str], list[dict[str, Any]]]:
    from flow360.component.simulation.services import ValidationCalledBy, validate_model

    validated, errors, warnings = validate_model(
        params_as_dict=params,
        validated_by=ValidationCalledBy.LOCAL,
        root_item_type=root_item_type,
        validation_level=validation_level,
    )
    if errors:
        raise ValueError(json.dumps(errors, ensure_ascii=False, sort_keys=True))
    if validated is None:
        raise ValueError("Flow360 validation returned no model and no errors")
    return ["json.parse", "flow360.deserialize", f"flow360.validate:{validation_level}"], warnings


def artifact_record(root: pathlib.Path, path: pathlib.Path, checks: list[str]) -> dict[str, Any]:
    return {"sha256": sha256_file(path), "checks": checks, "path": path.relative_to(root).as_posix()}


def validate_one(
    root: pathlib.Path,
    manifest_path: pathlib.Path,
    manifest_validator: Draft202012Validator,
    evidence_validator: Draft202012Validator,
    pedagogy_validator: Draft202012Validator,
    pinned: dict[str, Any],
    feature_ids: set[str],
) -> tuple[str, dict[str, Any]]:
    root = root.resolve()
    manifest_path = manifest_path.resolve()
    tutorial_dir = manifest_path.parent
    result: dict[str, Any] = {
        "manifest": manifest_path.relative_to(root).as_posix(),
        "status": "failed",
        "artifacts": {},
        "coverage": {},
        "warnings": [],
        "errors": [],
    }
    try:
        manifest = load_yaml(manifest_path)
        schema_errors = sorted(manifest_validator.iter_errors(manifest), key=lambda error: list(error.path))
        if schema_errors:
            details = [f"{'/'.join(map(str, error.path)) or '<root>'}: {error.message}" for error in schema_errors]
            raise ValueError("manifest schema: " + "; ".join(details))

        tutorial_id = manifest["id"]
        expected_dir = f"{tutorial_id}-{manifest['slug']}"
        if tutorial_dir.name != expected_dir:
            raise ValueError(f"tutorial directory must be named {expected_dir}")
        flow360_target = manifest["flow360"]
        if flow360_target["api_version"] != pinned["api_version"] or flow360_target["package_version"] != pinned["package_version"]:
            raise ValueError("tutorial Flow360 target does not match tutorials/flow360-version.json")

        artifact_paths: dict[str, pathlib.Path] = {}
        seen_artifact_paths: set[pathlib.Path] = set()
        for name, relative in manifest["artifacts"].items():
            path = safe_path(root, tutorial_dir, relative)
            if not path.is_file():
                raise ValueError(f"artifact {name} does not exist: {relative}")
            if path in seen_artifact_paths:
                raise ValueError(f"artifact path is declared more than once: {relative}")
            seen_artifact_paths.add(path)
            artifact_paths[name] = path
            checks = ["tutorial.contract", "exists"]
            if path.suffix in {".yaml", ".yml"}:
                if load_yaml(path) is None:
                    raise ValueError(f"artifact {name} is empty: {relative}")
                checks.append("yaml.parse")
            elif path.suffix == ".json" and name != "simulation":
                json.loads(path.read_text(encoding="utf-8"))
                checks.append("json.parse")
            elif path.suffix == ".py":
                compile(path.read_text(encoding="utf-8"), str(path), "exec")
                checks.append("python.compile")
            elif path.suffix == ".md" and not path.read_text(encoding="utf-8").strip():
                raise ValueError(f"artifact {name} is empty: {relative}")
            result["artifacts"][path.relative_to(root).as_posix()] = artifact_record(root, path, checks)

        evidence_path = safe_path(root, tutorial_dir, manifest["evidence"]["contract"])
        if not evidence_path.is_file():
            raise ValueError(f"evidence contract does not exist: {manifest['evidence']['contract']}")
        evidence = load_yaml(evidence_path)
        evidence_errors = sorted(evidence_validator.iter_errors(evidence), key=lambda error: list(error.path))
        if evidence_errors:
            details = [f"{'/'.join(map(str, error.path)) or '<root>'}: {error.message}" for error in evidence_errors]
            raise ValueError("evidence schema: " + "; ".join(details))
        criterion_ids = [criterion["id"] for criterion in evidence["criteria"]]
        if len(criterion_ids) != len(set(criterion_ids)):
            raise ValueError("evidence criterion ids must be unique")
        result["artifacts"][evidence_path.relative_to(root).as_posix()] = artifact_record(
            root, evidence_path, ["tutorial.contract", "yaml.parse", "evidence.contract"]
        )

        if manifest["schema_version"] == 2:
            pedagogy_path = artifact_paths["pedagogy"]
            pedagogy = load_yaml(pedagogy_path)
            pedagogy_errors = sorted(pedagogy_validator.iter_errors(pedagogy), key=lambda error: list(error.path))
            if pedagogy_errors:
                details = [f"{'/'.join(map(str, error.path)) or '<root>'}: {error.message}" for error in pedagogy_errors]
                raise ValueError("pedagogy schema: " + "; ".join(details))
            result["artifacts"][pedagogy_path.relative_to(root).as_posix()] = artifact_record(
                root, pedagogy_path, ["tutorial.contract", "yaml.parse", "pedagogy.v2"]
            )

        simulation_path = artifact_paths["simulation"]
        baseline = json.loads(simulation_path.read_text(encoding="utf-8"))
        if not isinstance(baseline, dict):
            raise ValueError("simulation artifact must contain a JSON object")
        checks, warnings = validate_flow360(
            baseline, flow360_target["root_item_type"], flow360_target["validation_level"]
        )
        result["artifacts"][simulation_path.relative_to(root).as_posix()] = artifact_record(
            root, simulation_path, ["tutorial.contract", *checks]
        )
        result["warnings"].extend(json.loads(json.dumps(warnings, default=str)))

        for asset in manifest.get("assets", []):
            path = safe_path(root, tutorial_dir, asset["path"])
            if not path.is_file():
                raise ValueError(f"asset does not exist: {asset['path']}")
            actual = sha256_file(path)
            if actual != asset["sha256"]:
                raise ValueError(f"asset checksum mismatch: {asset['path']}")
            result["artifacts"][path.relative_to(root).as_posix()] = artifact_record(
                root, path, ["tutorial.contract", "asset.sha256"]
            )

        variant_ids: set[str] = set()
        for variant in manifest.get("variants", []):
            if variant["id"] in variant_ids:
                raise ValueError(f"duplicate variant id: {variant['id']}")
            variant_ids.add(variant["id"])
            patch_path = safe_path(root, tutorial_dir, variant["patch"])
            patch = json.loads(patch_path.read_text(encoding="utf-8"))
            level = variant.get("validation_level", flow360_target["validation_level"])
            checks, warnings = validate_flow360(merge_patch(baseline, patch), flow360_target["root_item_type"], level)
            result["warnings"].extend(json.loads(json.dumps(warnings, default=str)))
            result["artifacts"][patch_path.relative_to(root).as_posix()] = artifact_record(
                root, patch_path, ["tutorial.contract", "json.merge-patch", *checks]
            )
            if "evidence" in variant:
                path = safe_path(root, tutorial_dir, variant["evidence"])
                variant_evidence = load_yaml(path)
                variant_errors = sorted(evidence_validator.iter_errors(variant_evidence), key=lambda error: list(error.path))
                if variant_errors:
                    details = [f"{'/'.join(map(str, error.path)) or '<root>'}: {error.message}" for error in variant_errors]
                    raise ValueError(f"variant {variant['id']} evidence schema: " + "; ".join(details))
                result["artifacts"][path.relative_to(root).as_posix()] = artifact_record(
                    root, path, ["tutorial.contract", "yaml.parse", "evidence.contract"]
                )

        declared_artifacts = set(result["artifacts"])
        coverage_features: set[str] = set()
        for item in manifest["coverage"]:
            if item["feature"] not in feature_ids:
                raise ValueError(f"unknown coverage feature: {item['feature']}")
            if item["feature"] in coverage_features:
                raise ValueError(f"duplicate coverage feature: {item['feature']}")
            coverage_features.add(item["feature"])
            coverage_artifact = safe_path(root, tutorial_dir, item["artifact"]).relative_to(root).as_posix()
            if coverage_artifact not in declared_artifacts:
                raise ValueError(f"coverage artifact is not declared: {item['artifact']}")
            result["coverage"][item["feature"]] = coverage_artifact

        result["status"] = "passed"
        return tutorial_id, result
    except Exception as error:  # report all tutorial failures together
        result["errors"].append(str(error))
        fallback_id = manifest_path.parent.name.split("-", 1)[0]
        return fallback_id, result


def run(root: pathlib.Path) -> tuple[dict[str, Any], bool]:
    pinned = json.loads((root / "tutorials" / "flow360-version.json").read_text())
    installed = importlib.metadata.version(pinned["package"])
    if installed != pinned["package_version"]:
        raise ValueError(f"installed {pinned['package']} {installed}, expected {pinned['package_version']}")
    registry_path = root / "tutorials" / "feature-registry.json"
    registry = json.loads(registry_path.read_text())
    schema = json.loads((root / "tutorials" / "schema" / "tutorial.schema.json").read_text())
    validator = Draft202012Validator(schema)
    evidence_schema = json.loads((root / "tutorials" / "schema" / "evidence.schema.json").read_text())
    evidence_validator = Draft202012Validator(evidence_schema)
    pedagogy_schema = json.loads((root / "tutorials" / "schema" / "pedagogy.schema.json").read_text())
    pedagogy_validator = Draft202012Validator(pedagogy_schema)
    feature_ids = {feature["id"] for feature in registry["features"]}
    report: dict[str, Any] = {
        "report_version": REPORT_VERSION,
        "api_version": pinned["api_version"],
        "package_version": installed,
        "registry_sha256": sha256_file(registry_path),
        "tutorials": {},
    }
    passed = True
    for manifest_path in sorted((root / "tutorials").glob("T[0-9][0-9]-*/tutorial.yaml")):
        tutorial_id, result = validate_one(root, manifest_path, validator, evidence_validator, pedagogy_validator, pinned, feature_ids)
        if tutorial_id in report["tutorials"]:
            raise ValueError(f"duplicate tutorial id: {tutorial_id}")
        report["tutorials"][tutorial_id] = result
        passed = passed and result["status"] == "passed"
    return report, passed


def validate_report(root: pathlib.Path, report: dict[str, Any]) -> None:
    schema = json.loads((root / "tutorials" / "schema" / "validation-report.schema.json").read_text())
    errors = sorted(Draft202012Validator(schema).iter_errors(report), key=lambda error: list(error.path))
    if errors:
        details = [f"{'/'.join(map(str, error.path)) or '<root>'}: {error.message}" for error in errors]
        raise ValueError("validation report schema: " + "; ".join(details))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path(".tutorial-validation/report.json"))
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        report, passed = run(root)
        validate_report(root, report)
    except Exception as error:
        print(f"tutorial validation: {error}", file=sys.stderr)
        return 2
    output = args.output if args.output.is_absolute() else root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    for tutorial_id, result in report["tutorials"].items():
        print(f"{result['status'].upper()} {tutorial_id} {result['manifest']}")
        for error in result["errors"]:
            print(f"  {error}")
    print(f"tutorials={len(report['tutorials'])} passed={sum(item['status'] == 'passed' for item in report['tutorials'].values())}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
