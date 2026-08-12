package compareworkspace

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/sunjuzhong/vibe-flow360/internal/comparison"
)

func TestWorkspacePersistsViewStateAndAISessions(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateInput{
		Name: "Cylinder decision",
		Participants: []Participant{
			{ProjectID: "prj-a", CaseID: "case-a", CaseNameSnapshot: "Baseline"},
			{ProjectID: "prj-a", CaseID: "case-b", CaseNameSnapshot: "Candidate"},
		},
		Snapshot:  comparison.CompareResult{Cases: []comparison.CaseComparison{{ID: "case-a"}, {ID: "case-b"}}},
		ViewState: json.RawMessage(`{"active_view":"visual"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Participants[0].Role != "baseline" || created.Participants[1].Role != "candidate" {
		t.Fatalf("unexpected roles: %+v", created.Participants)
	}
	if _, err := store.UpdateViewState(created.ID, json.RawMessage(`{"active_view":"parameters"}`)); err != nil {
		t.Fatal(err)
	}
	updated, err := store.AppendAISession(created.ID, AISession{Question: "Which is better?", Analysis: "Baseline is steadier."})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.AISessions) != 1 || updated.AISessions[0].EvidenceRevisionID != created.ActiveRevisionID {
		t.Fatalf("unexpected AI sessions: %+v", updated.AISessions)
	}
	reopened, err := NewStore(store.dir)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := reopened.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	var viewState map[string]any
	if err := json.Unmarshal(loaded.ViewState, &viewState); err != nil {
		t.Fatal(err)
	}
	if viewState["active_view"] != "parameters" || len(loaded.AISessions) != 1 {
		t.Fatalf("workspace did not persist: %+v", loaded)
	}
}

func TestWorkspaceRejectsInvalidInput(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(CreateInput{Name: "one", Participants: []Participant{{CaseID: "case-a"}}}); err == nil {
		t.Fatal("expected participant validation error")
	}
	if _, err := store.Get("../escape"); err == nil {
		t.Fatal("expected invalid ID error")
	}
}

func TestWorkspaceLifecycle(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateInput{
		Name:         "Decision",
		Participants: []Participant{{CaseID: "case-a"}, {CaseID: "case-b"}},
		Snapshot:     comparison.CompareResult{},
	})
	if err != nil {
		t.Fatal(err)
	}
	archived, err := store.SetStatus(created.ID, "archived")
	if err != nil || archived.Status != "archived" {
		t.Fatalf("archive failed: %+v %v", archived, err)
	}
	duplicated, err := store.Duplicate(created.ID, "Decision copy")
	if err != nil || duplicated.ID == created.ID || duplicated.Name != "Decision copy" || duplicated.Status != "active" {
		t.Fatalf("duplicate failed: %+v %v", duplicated, err)
	}
	if _, err := store.AppendAISession(created.ID, AISession{EvidenceRevisionID: "rev-missing", Analysis: "invalid"}); err == nil {
		t.Fatal("expected unknown revision to be rejected")
	}
	if err := store.Delete(created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected deleted workspace to be absent, got %v", err)
	}
}

func TestWorkspaceAddsImmutableEvidenceRevision(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateInput{
		Name:         "History",
		Participants: []Participant{{CaseID: "case-a"}, {CaseID: "case-b"}},
		Snapshot:     comparison.CompareResult{Cases: []comparison.CaseComparison{{ID: "case-a", Status: "running"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := store.AddRevision(created.ID, comparison.CompareResult{Cases: []comparison.CaseComparison{{ID: "case-a", Status: "completed"}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Revisions) != 2 || updated.Revisions[1].Number != 2 || updated.ActiveRevisionID != updated.Revisions[1].ID {
		t.Fatalf("unexpected revision history: %+v", updated.Revisions)
	}
	if updated.Revisions[0].Snapshot.Cases[0].Status != "running" || updated.Revisions[1].Snapshot.Cases[0].Status != "completed" {
		t.Fatalf("prior evidence was overwritten: %+v", updated.Revisions)
	}
}
