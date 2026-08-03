package annotations

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func boolPointer(value bool) *bool { return &value }

func validInput(projectID string) CreateInput {
	ref := ResourceRef{ID: "geo-1", Type: "Geometry", Version: "v1"}
	return CreateInput{
		SchemaVersion:   SchemaVersion,
		ResourceRef:     ref,
		CoordinateFrame: CoordinateFrame{Kind: "asset-local", ResourceRef: &ref},
		ToolID:          "distance",
		Name:            "Inlet clearance",
		Points: []PickResult{
			{
				LocalPosition: []float64{0, 0, 0}, WorldPosition: []float64{10, 0, 0},
				ProjectID: projectID, ResourceRef: ref,
				CoordinateFrame: CoordinateFrame{Kind: "asset-local", ResourceRef: &ref},
				EntityID:        "face-1", EntityType: "face", Snap: Snap{Type: "surface"},
			},
			{
				LocalPosition: []float64{2, 0, 0}, WorldPosition: []float64{12, 0, 0},
				ProjectID: projectID, ResourceRef: ref,
				CoordinateFrame: CoordinateFrame{Kind: "asset-local", ResourceRef: &ref},
				EntityID:        "face-2", EntityType: "face", Snap: Snap{Type: "surface"},
			},
		},
		Result:  json.RawMessage(`{"distance":2}`),
		Style:   map[string]json.RawMessage{"color": json.RawMessage(`"#fff"`)},
		Visible: boolPointer(true),
	}
}

func TestStoreCRUDPersistsAcrossRestart(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	list, err := store.List("project-a")
	if err != nil || list == nil || len(list) != 0 {
		t.Fatalf("empty list = %#v, %v", list, err)
	}
	created, err := store.Create("project-a", validInput("project-a"))
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.ProjectID != "project-a" || created.SchemaVersion != SchemaVersion {
		t.Fatalf("unexpected created annotation: %#v", created)
	}
	if created.CreatedAt.IsZero() || !created.CreatedAt.Equal(created.UpdatedAt) {
		t.Fatalf("server timestamps were not assigned: %#v", created)
	}

	restarted, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := restarted.Get("project-a", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	var loadedResult, createdResult any
	if err := json.Unmarshal(loaded.Result, &loadedResult); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(created.Result, &createdResult); err != nil {
		t.Fatal(err)
	}
	if loaded.ID != created.ID || !jsonValuesEqual(loadedResult, createdResult) {
		t.Fatalf("restart lost data: %#v", loaded)
	}
	name := "Updated"
	style := map[string]json.RawMessage{"width": json.RawMessage(`2`)}
	visible := false
	updated, err := restarted.Patch("project-a", created.ID, PatchInput{
		Name: &name, Style: &style, Visible: &visible,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != name || updated.Visible || !updated.UpdatedAt.After(updated.CreatedAt) {
		t.Fatalf("patch failed: %#v", updated)
	}
	if err := restarted.Delete("project-a", created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.Get("project-a", created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get after delete = %v", err)
	}
	if err := restarted.Delete("project-a", created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete = %v", err)
	}
}

func jsonValuesEqual(left, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}

func TestStoreEnforcesProjectIsolation(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create("project-b", validInput("project-b"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("project-a", created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-project get = %v", err)
	}
	visible := false
	if _, err := store.Patch("project-a", created.ID, PatchInput{Visible: &visible}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-project patch = %v", err)
	}
	if err := store.Delete("project-a", created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-project delete = %v", err)
	}
	if _, err := store.Get("project-b", created.ID); err != nil {
		t.Fatalf("owner annotation changed: %v", err)
	}

	spoofed := validInput("project-a")
	spoofed.Points[0].ProjectID = "project-b"
	if _, err := store.Create("project-a", spoofed); !errors.Is(err, ErrValidation) {
		t.Fatalf("spoofed point project = %v", err)
	}
}

func TestStoreAllowsOwningResourceToUseFallbackAssetFrame(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := validInput("project-a")
	geometryRef := input.ResourceRef
	input.ResourceRef = ResourceRef{ID: "case-1", Type: "Case"}
	input.CoordinateFrame = CoordinateFrame{Kind: "asset-local", ResourceRef: &geometryRef}
	input.Points[0].Snap = Snap{
		Type: "cad-vertex", Method: "cad-topology", StableID: "body:vertex:1",
	}
	created, err := store.Create("project-a", input)
	if err != nil {
		t.Fatal(err)
	}
	if created.ResourceRef.ID != "case-1" || created.CoordinateFrame.ResourceRef == nil ||
		created.CoordinateFrame.ResourceRef.ID != geometryRef.ID {
		t.Fatalf("fallback ownership/frame was not preserved: %#v", created)
	}
}

func TestStoreRejectsTraversalInvalidSchemaAndNonFiniteCoordinates(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, projectID := range []string{"../escape", "a/b", ".", "..", "project%2fescape"} {
		if _, err := store.Create(projectID, validInput(projectID)); !errors.Is(err, ErrValidation) {
			t.Errorf("project %q error = %v", projectID, err)
		}
	}
	input := validInput("project-a")
	input.SchemaVersion = 99
	if _, err := store.Create("project-a", input); !errors.Is(err, ErrValidation) {
		t.Fatalf("schema error = %v", err)
	}
	input = validInput("project-a")
	input.Points[0].LocalPosition[1] = math.Inf(1)
	if _, err := store.Create("project-a", input); !errors.Is(err, ErrValidation) {
		t.Fatalf("infinite coordinate error = %v", err)
	}
	input = validInput("project-a")
	input.Points[0].WorldPosition[2] = math.NaN()
	if _, err := store.Create("project-a", input); !errors.Is(err, ErrValidation) {
		t.Fatalf("NaN coordinate error = %v", err)
	}
	input = validInput("project-a")
	input.ResourceRef.ID = "../../geo"
	if _, err := store.Create("project-a", input); !errors.Is(err, ErrValidation) {
		t.Fatalf("resource traversal error = %v", err)
	}
	input = validInput("project-a")
	input.Result = json.RawMessage(`{"distance":1e999}`)
	if _, err := store.Create("project-a", input); !errors.Is(err, ErrValidation) {
		t.Fatalf("non-finite result error = %v", err)
	}
}

func TestStoreReportsCorruptJSON(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "project-a")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ann-corrupt.json"), []byte(`{"broken":`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("project-a", "ann-corrupt"); err == nil {
		t.Fatal("Get accepted corrupt JSON")
	}
	if _, err := store.List("project-a"); err == nil {
		t.Fatal("List silently ignored corrupt JSON")
	}
}

func TestStoreConcurrentCreatesAreDurableAndAtomic(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	const count = 32
	var wait sync.WaitGroup
	errorsChannel := make(chan error, count)
	for index := 0; index < count; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, createErr := store.Create("project-a", validInput("project-a"))
			errorsChannel <- createErr
		}()
	}
	wait.Wait()
	close(errorsChannel)
	for err := range errorsChannel {
		if err != nil {
			t.Fatal(err)
		}
	}
	restarted, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	list, err := restarted.List("project-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != count {
		t.Fatalf("got %d annotations, want %d", len(list), count)
	}
	entries, err := os.ReadDir(filepath.Join(root, "project-a"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			t.Fatalf("atomic write residue: %s", entry.Name())
		}
	}
}

func TestStoreUsesPrivateDiskPermissions(t *testing.T) {
	root := filepath.Join(t.TempDir(), "annotations")
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create("project-a", validInput("project-a"))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		path string
		mode os.FileMode
	}{
		{root, 0o700},
		{filepath.Join(root, "project-a"), 0o700},
		{filepath.Join(root, "project-a", created.ID+".json"), 0o600},
	} {
		info, statErr := os.Stat(test.path)
		if statErr != nil {
			t.Fatal(statErr)
		}
		if got := info.Mode().Perm(); got != test.mode {
			t.Errorf("%s mode = %o, want %o", test.path, got, test.mode)
		}
	}
}

func TestPatchRejectsEmptyAndInvalidStyle(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create("project-a", validInput("project-a"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Patch("project-a", created.ID, PatchInput{}); !errors.Is(err, ErrValidation) {
		t.Fatalf("empty patch = %v", err)
	}
	style := map[string]json.RawMessage{"bad": json.RawMessage(`{`)}
	if _, err := store.Patch("project-a", created.ID, PatchInput{Style: &style}); !errors.Is(err, ErrValidation) {
		t.Fatalf("invalid style = %v", err)
	}
}

func TestPatchUpdatesGeometryWhilePreservingIdentity(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create("project-a", validInput("project-a"))
	if err != nil {
		t.Fatal(err)
	}
	points := cloneAnnotation(created).Points
	points[0].LocalPosition = []float64{0.25, 0.5, 0.75}
	result := json.RawMessage(`{"distance":3.5}`)
	updated, err := store.Patch("project-a", created.ID, PatchInput{Points: &points, Result: &result})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ID != created.ID || updated.ProjectID != created.ProjectID || !updated.CreatedAt.Equal(created.CreatedAt) {
		t.Fatalf("patch changed immutable identity: %#v", updated)
	}
	if updated.Points[0].LocalPosition[0] != 0.25 || string(updated.Result) != string(result) {
		t.Fatalf("geometry patch not persisted: %#v", updated)
	}
}

func TestStoreRejectsOversizePayloadWithoutLeavingFile(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	input := validInput("project-a")
	input.Result = json.RawMessage(`"` + string(make([]byte, MaxPayloadSize)) + `"`)
	for index := 1; index < len(input.Result)-1; index++ {
		input.Result[index] = 'x'
	}
	if _, err := store.Create("project-a", input); !errors.Is(err, ErrValidation) {
		t.Fatalf("oversize payload = %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(root, "project-a"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("oversize write left files: %#v", entries)
	}
}
