package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSelectorMatchesAllSpecifiedDimensions(t *testing.T) {
	selector, err := compileSelector(selector{
		Kinds:          []string{"schema_field"},
		OwnerPattern:   `^Wall$`,
		FeaturePattern: `\.roughness_height$`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !selector.matches(feature{ID: "schema:field:Wall.roughness_height", Kind: "schema_field", Owner: "Wall"}) {
		t.Fatal("expected selector to match")
	}
	if selector.matches(feature{ID: "schema:field:Wall.name", Kind: "schema_field", Owner: "Wall"}) {
		t.Fatal("selector matched the wrong field")
	}
}

func TestSelectorRejectsEmptyAndInvalidPatterns(t *testing.T) {
	if _, err := compileSelector(selector{}); err == nil {
		t.Fatal("expected empty selector to fail")
	}
	if _, err := compileSelector(selector{OwnerPattern: "["}); err == nil {
		t.Fatal("expected invalid pattern to fail")
	}
}

func TestVerifiedSchemaFeatureRequiresFreshFlow360Evidence(t *testing.T) {
	root := t.TempDir()
	artifactPath := filepath.Join(root, "tutorials", "T01-first", "simulation.json")
	if err := os.MkdirAll(filepath.Dir(artifactPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifactPath, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	digest, err := fileSHA256(artifactPath)
	if err != nil {
		t.Fatal(err)
	}
	relative := "tutorials/T01-first/simulation.json"
	report := validationReport{Tutorials: map[string]tutorialValidation{
		"T01": {
			Status: "passed",
			Coverage: map[string]string{
				"schema:type:Wall": relative,
			},
			Artifacts: map[string]validatedArtifact{
				relative: {SHA256: digest, Checks: []string{"flow360.deserialize", "flow360.validate:Case"}},
			},
		},
	}}
	err = validateVerified(root, feature{ID: "schema:type:Wall", Kind: "schema_type"}, mapping{Tutorial: "T01", Artifact: relative}, report)
	if err != nil {
		t.Fatal(err)
	}
	report.Tutorials["T01"].Artifacts[relative] = validatedArtifact{SHA256: digest, Checks: []string{"exists"}}
	if err := validateVerified(root, feature{ID: "schema:type:Wall", Kind: "schema_type"}, mapping{Tutorial: "T01", Artifact: relative}, report); err == nil {
		t.Fatal("expected missing Flow360 checks to fail")
	}
}

func TestVerifiedArtifactCannotEscapeRepository(t *testing.T) {
	err := validateVerified(t.TempDir(), feature{ID: "schema:type:Wall", Kind: "schema_type"}, mapping{Tutorial: "T01", Artifact: "../simulation.json"}, validationReport{Tutorials: map[string]tutorialValidation{"T01": {Status: "passed"}}})
	if err == nil {
		t.Fatal("expected escaping artifact path to fail")
	}
}

func TestSelectMappingRequiresExactlyOneOverride(t *testing.T) {
	planned := mapping{Tutorial: "T01", Status: "planned"}
	verified := mapping{Tutorial: "T01", Status: "verified", Override: true}
	selected, ok, err := selectMapping("schema:type:SimulationParams", []mapping{planned, verified})
	if err != nil || !ok || selected.Status != "verified" {
		t.Fatalf("expected verified override, got %#v, %v, %v", selected, ok, err)
	}
	if _, _, err := selectMapping("schema:type:SimulationParams", []mapping{planned, planned}); err == nil {
		t.Fatal("expected ambiguous mappings to fail")
	}
}
