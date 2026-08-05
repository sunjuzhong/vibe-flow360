package main

import "testing"

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
