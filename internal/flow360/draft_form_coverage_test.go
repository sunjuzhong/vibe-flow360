package flow360

import (
	"context"
	"encoding/json"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// publicDraftFormRoots are the public SimulationParams root groups that a Draft
// Form must be able to edit.
//
// `version` and `unit_system` describe the document/runtime context rather than
// an engineering decision, and `private_attribute_*` is Flow360-internal state
// cached on the document. Both stay in the canonical candidate and the JSON
// fallback, but must not become Form controls: editing them would make a Draft
// incompatible with its remote Flow360 context.
var publicDraftFormRoots = []string{
	"meshing",
	"models",
	"operating_condition",
	"outputs",
	"reference_geometry",
	"run_control",
	"time_stepping",
	"user_defined_dynamics",
	"user_defined_fields",
}

// draftFormJSONLeafBudget is the acceptance baseline recorded in
// docs/draft-form-schema-coverage.md: the number of leaf nodes that still render
// as an unconstrained raw-JSON editor for the representative Geometry→Case
// projection. Fixed numeric vectors and colors are projected as structured
// tuple controls instead; this ceiling fails the build when a regression pushes
// a growing part of the tree back to JSON text. The observed baseline is 46;
// the small headroom absorbs incidental projection growth without masking a
// wholesale reversion to JSON.
const draftFormJSONLeafBudget = 60

func TestInstalledSchemaDraftFormExposesEveryPublicRootGroup(t *testing.T) {
	if os.Getenv("VIBESIM_TEST_FLOW360_SCHEMA") != "1" {
		t.Skip("set VIBESIM_TEST_FLOW360_SCHEMA=1 to exercise the installed Flow360 schema")
	}
	form, err := NewClient().PlanFormSchema(
		context.Background(), "Geometry", "case", json.RawMessage(`{"unit_system":{"name":"SI"}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	// Guard the guards: every assertion below is satisfiable by an empty or
	// truncated projection, so require the full route and a non-trivial walk
	// before trusting any of them.
	if len(form.Schemas) != len(form.Stages) || len(form.Stages) == 0 {
		t.Fatalf("expected a schema for every projected stage %v, got %d", form.Stages, len(form.Schemas))
	}
	roots := map[string]bool{}
	jsonLeaves := 0
	privatePaths := []string{}
	for stage, raw := range form.Schemas {
		var schema map[string]any
		if err := json.Unmarshal(raw, &schema); err != nil {
			t.Fatalf("%s editor schema is not valid JSON: %v", stage, err)
		}
		properties, _ := schema["properties"].(map[string]any)
		for name, node := range properties {
			roots[name] = true
			walkDraftFormSchema(node, name, &jsonLeaves, &privatePaths)
		}
	}
	for _, want := range publicDraftFormRoots {
		if !roots[want] {
			t.Errorf("Draft Form projection is missing public root group %q; got %v", want, sortedDraftFormNames(roots))
		}
	}
	for name := range roots {
		if name == "version" || name == "unit_system" || strings.HasPrefix(name, "private_attribute") {
			t.Errorf("Draft Form projection exposed non-editable context root %q", name)
		}
	}
	if len(privatePaths) > 0 {
		t.Errorf("Draft Form projection exposed private Flow360 attributes: %v", privatePaths)
	}
	// A projection that walks to nothing would pass the budget below by
	// accident, which is exactly the regression this test exists to catch.
	if jsonLeaves == 0 {
		t.Fatalf("expected the projected Form to contain raw-JSON leaves to measure; walked none for %v", form.Stages)
	}
	if jsonLeaves > draftFormJSONLeafBudget {
		t.Errorf("Draft Form fell back to raw JSON for %d leaf nodes (budget %d)", jsonLeaves, draftFormJSONLeafBudget)
	}
	t.Logf("Draft Form projection: %d root groups, %d raw-JSON leaf nodes", len(roots), jsonLeaves)
}

// walkDraftFormSchema mirrors how SchemaForm traverses a projected editor schema:
// object properties, array items, union variants, and quantity value schemas.
func walkDraftFormSchema(node any, path string, jsonLeaves *int, privatePaths *[]string) {
	current, ok := node.(map[string]any)
	if !ok {
		return
	}
	if strings.HasPrefix(path, "private_attribute") {
		*privatePaths = append(*privatePaths, path)
		return
	}
	if current["type"] == "json" {
		*jsonLeaves++
		return
	}
	if properties, ok := current["properties"].(map[string]any); ok {
		for name, child := range properties {
			walkDraftFormSchema(child, path+"."+name, jsonLeaves, privatePaths)
		}
	}
	if items, ok := current["items"]; ok {
		walkDraftFormSchema(items, path+"[]", jsonLeaves, privatePaths)
	}
	if valueSchema, ok := current["value_schema"]; ok {
		walkDraftFormSchema(valueSchema, path+".value", jsonLeaves, privatePaths)
	}
	if variants, ok := current["variants"].([]any); ok {
		for index, variant := range variants {
			walkDraftFormSchema(variant, path+"<variant:"+strconv.Itoa(index)+">", jsonLeaves, privatePaths)
		}
	}
}

func sortedDraftFormNames(names map[string]bool) []string {
	out := make([]string, 0, len(names))
	for name := range names {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}
