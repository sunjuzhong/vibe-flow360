from __future__ import annotations

import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest import mock

import yaml
from jsonschema import Draft202012Validator

from scripts import validate_tutorials as subject


ROOT = pathlib.Path(__file__).resolve().parents[1]


class TutorialValidatorTests(unittest.TestCase):
    def test_manifest_example_matches_schema(self):
        schema = json.loads((ROOT / "tutorials/schema/tutorial.schema.json").read_text())
        example = yaml.safe_load((ROOT / "tutorials/schema/tutorial.example.yaml").read_text())
        Draft202012Validator(schema).validate(example)

    def test_merge_patch_follows_rfc7396(self):
        target = {"a": {"b": 1, "c": 2}, "keep": True}
        patch = {"a": {"b": 3, "c": None}, "new": [1, 2]}
        self.assertEqual(subject.merge_patch(target, patch), {"a": {"b": 3}, "keep": True, "new": [1, 2]})
        self.assertEqual(target["a"]["b"], 1)

    def test_safe_path_rejects_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            tutorial = root / "tutorials" / "T01-first"
            tutorial.mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, "escapes tutorial"):
                subject.safe_path(root, tutorial, "../secret.json")

    def test_valid_contract_records_flow360_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            manifest_path = self.make_tutorial(root)
            validator = Draft202012Validator(json.loads((ROOT / "tutorials/schema/tutorial.schema.json").read_text()))
            evidence_validator = Draft202012Validator(json.loads((ROOT / "tutorials/schema/evidence.schema.json").read_text()))
            pedagogy_validator = Draft202012Validator(json.loads((ROOT / "tutorials/schema/pedagogy.schema.json").read_text()))
            with mock.patch.object(
                subject,
                "validate_flow360",
                return_value=(["json.parse", "flow360.deserialize", "flow360.validate:Case"], []),
            ):
                tutorial_id, result = subject.validate_one(
                    root,
                    manifest_path,
                    validator,
                    evidence_validator,
                    pedagogy_validator,
                    {"api_version": "release-25.10", "package_version": "25.10.3"},
                    {"schema:type:SimulationParams"},
                )
            self.assertEqual(tutorial_id, "T01")
            self.assertEqual(result["status"], "passed")
            simulation = result["artifacts"]["tutorials/T01-first/simulation.json"]
            self.assertIn("flow360.deserialize", simulation["checks"])
            self.assertEqual(simulation["sha256"], hashlib.sha256(b"{}\n").hexdigest())

    def test_unknown_coverage_feature_fails_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            manifest_path = self.make_tutorial(root, feature="schema:type:Unknown")
            validator = Draft202012Validator(json.loads((ROOT / "tutorials/schema/tutorial.schema.json").read_text()))
            evidence_validator = Draft202012Validator(json.loads((ROOT / "tutorials/schema/evidence.schema.json").read_text()))
            pedagogy_validator = Draft202012Validator(json.loads((ROOT / "tutorials/schema/pedagogy.schema.json").read_text()))
            with mock.patch.object(subject, "validate_flow360", return_value=(["flow360.deserialize", "flow360.validate:Case"], [])):
                _, result = subject.validate_one(
                    root,
                    manifest_path,
                    validator,
                    evidence_validator,
                    pedagogy_validator,
                    {"api_version": "release-25.10", "package_version": "25.10.3"},
                    {"schema:type:SimulationParams"},
                )
            self.assertEqual(result["status"], "failed")
            self.assertIn("unknown coverage feature", result["errors"][0])

    def test_variant_patch_can_own_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            manifest_path = self.make_tutorial(root)
            tutorial = manifest_path.parent
            (tutorial / "variant.json").write_text('{"models": []}\n')
            manifest = yaml.safe_load(manifest_path.read_text())
            manifest["variants"] = [{"id": "no-models", "title": "Remove models", "patch": "variant.json"}]
            manifest["coverage"][0]["artifact"] = "variant.json"
            manifest_path.write_text(yaml.safe_dump(manifest, sort_keys=False))
            validator = Draft202012Validator(json.loads((ROOT / "tutorials/schema/tutorial.schema.json").read_text()))
            evidence_validator = Draft202012Validator(json.loads((ROOT / "tutorials/schema/evidence.schema.json").read_text()))
            pedagogy_validator = Draft202012Validator(json.loads((ROOT / "tutorials/schema/pedagogy.schema.json").read_text()))
            with mock.patch.object(
                subject,
                "validate_flow360",
                return_value=(["json.parse", "flow360.deserialize", "flow360.validate:Case"], []),
            ):
                _, result = subject.validate_one(
                    root,
                    manifest_path,
                    validator,
                    evidence_validator,
                    pedagogy_validator,
                    {"api_version": "release-25.10", "package_version": "25.10.3"},
                    {"schema:type:SimulationParams"},
                )
            self.assertEqual(result["status"], "passed")
            self.assertEqual(result["coverage"]["schema:type:SimulationParams"], "tutorials/T01-first/variant.json")
            self.assertIn("json.merge-patch", result["artifacts"]["tutorials/T01-first/variant.json"]["checks"])

    def test_v2_manifest_requires_pedagogy_artifact(self):
        schema = json.loads((ROOT / "tutorials/schema/tutorial.schema.json").read_text())
        manifest = yaml.safe_load((ROOT / "tutorials/schema/tutorial.example.yaml").read_text())
        manifest["artifacts"].pop("pedagogy")
        errors = list(Draft202012Validator(schema).iter_errors(manifest))
        self.assertTrue(any("pedagogy" in error.message for error in errors))

    def test_pedagogy_example_matches_v2_schema(self):
        schema = json.loads((ROOT / "tutorials/schema/pedagogy.schema.json").read_text())
        example = yaml.safe_load((ROOT / "tutorials/schema/pedagogy.example.yaml").read_text())
        Draft202012Validator(schema).validate(example)

    def make_tutorial(self, root: pathlib.Path, feature: str = "schema:type:SimulationParams") -> pathlib.Path:
        tutorial = root / "tutorials" / "T01-first"
        tutorial.mkdir(parents=True)
        (tutorial / "intent.yaml").write_text("goal: test\n")
        (tutorial / "spec.yaml").write_text("kind: external-aero\n")
        (tutorial / "simulation.json").write_text("{}\n")
        (tutorial / "plan.md").write_text("# Plan\n")
        (tutorial / "pedagogy.yaml").write_text((ROOT / "tutorials/schema/pedagogy.example.yaml").read_text())
        evidence = {
            "schema_version": 1,
            "criteria": [
                {
                    "id": "simulation-valid",
                    "category": "provenance",
                    "description": "The pinned Flow360 package accepts the parameters.",
                    "artifact": "simulation.json",
                    "required": True,
                    "check": {"method": "present", "metric": "validation"},
                }
            ],
            "limitations": ["This fixture does not run a cloud simulation."],
        }
        (tutorial / "evidence.yaml").write_text(yaml.safe_dump(evidence, sort_keys=False))
        manifest = {
            "schema_version": 2,
            "id": "T01",
            "slug": "first",
            "title": "First tutorial",
            "summary": "Exercise the tutorial contract.",
            "flow360": {
                "api_version": "release-25.10",
                "package_version": "25.10.3",
                "root_item_type": "Geometry",
                "validation_level": "Case",
            },
            "artifacts": {
                "intent": "intent.yaml",
                "spec": "spec.yaml",
                "simulation": "simulation.json",
                "plan": "plan.md",
                "pedagogy": "pedagogy.yaml",
            },
            "evidence": {"contract": "evidence.yaml"},
            "coverage": [{"feature": feature, "section": "baseline", "artifact": "simulation.json"}],
        }
        path = tutorial / "tutorial.yaml"
        path.write_text(yaml.safe_dump(manifest, sort_keys=False))
        return path


if __name__ == "__main__":
    unittest.main()
