package flow360

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestT05ArtifactHasRegisteredDraftEntities(t *testing.T) {
	params, err := os.ReadFile(filepath.Join("..", "..", "tutorials", "T05-wake-volume-refinement", "simulation.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateDraftEntityReferences(params); err != nil {
		t.Fatalf("T05 artifact contains dangling Draft entities: %v", err)
	}
}

func TestValidateDraftEntityReferencesRequiresRegisteredVolume(t *testing.T) {
	params := json.RawMessage(`{
		"meshing":{"refinements":[{"entities":{"stored_entities":[{
			"name":"Near-body separation region",
			"private_attribute_entity_type_name":"Sphere",
			"private_attribute_id":"sphere-1"
		}]}}]},
		"private_attribute_asset_cache":{"project_entity_info":{"draft_entities":[]}}
	}`)
	err := ValidateDraftEntityReferences(params)
	if err == nil || !strings.Contains(err.Error(), "Near-body separation region") {
		t.Fatalf("expected dangling Sphere error, got %v", err)
	}
}

func TestValidateDraftEntityReferencesAcceptsRegisteredVolume(t *testing.T) {
	params := json.RawMessage(`{
		"meshing":{"refinements":[{"entities":{"stored_entities":[{
			"name":"Near-body separation region",
			"private_attribute_entity_type_name":"Sphere",
			"private_attribute_id":"sphere-1"
		}]}}]},
		"private_attribute_asset_cache":{"project_entity_info":{"draft_entities":[{
			"name":"Near-body separation region",
			"private_attribute_entity_type_name":"Sphere",
			"private_attribute_id":"sphere-1"
		}]}}
	}`)
	if err := ValidateDraftEntityReferences(params); err != nil {
		t.Fatalf("registered Sphere was rejected: %v", err)
	}
}

func TestDraftEntityReferenceFailureInvalidatesPreflight(t *testing.T) {
	params := json.RawMessage(`{
		"meshing":{"refinements":[{"entities":{"stored_entities":[{
			"name":"Wake core",
			"private_attribute_entity_type_name":"Cylinder",
			"private_attribute_id":"cylinder-1"
		}]}}]},
		"private_attribute_asset_cache":{"project_entity_info":{"draft_entities":[]}}
	}`)
	result := addDraftEntityReferencePreflight(PreflightResult{Valid: true}, params, []string{"SurfaceMesh", "VolumeMesh"})
	if result.Valid || len(result.Issues) != 1 {
		t.Fatalf("dangling entity did not fail preflight: %#v", result)
	}
	issue := result.Issues[0]
	if issue.Code != "draft_entity_unregistered" || issue.Path != "private_attribute_asset_cache.project_entity_info.draft_entities" {
		t.Fatalf("unexpected preflight issue: %#v", issue)
	}
}
