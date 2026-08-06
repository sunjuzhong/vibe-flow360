package agent

import (
	"errors"
	"testing"
)

func TestChatStorePersistsConversationByProjectResource(t *testing.T) {
	root := t.TempDir()
	store, err := NewChatStore(root)
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Append("project-1", "case-1",
		Message{Role: "user", Content: "Why did this case diverge?"},
		Message{Role: "assistant", Content: "The residual history is unstable."},
	)
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || len(created.Messages) != 2 {
		t.Fatalf("unexpected created session: %#v", created)
	}

	reopened, err := NewChatStore(root)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := reopened.Get("project-1", "case-1")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ID != created.ID || loaded.Messages[0].Content != "Why did this case diverge?" {
		t.Fatalf("conversation did not survive restart: %#v", loaded)
	}
	if _, err := reopened.Get("project-1", "case-2"); !errors.Is(err, ErrChatSessionNotFound) {
		t.Fatalf("resource conversations leaked across scope: %v", err)
	}
	if _, err := reopened.Get("project-2", "case-1"); !errors.Is(err, ErrChatSessionNotFound) {
		t.Fatalf("project conversations leaked across scope: %v", err)
	}
}

func TestChatStoreSeparatesDraftAndSourceResourceScopes(t *testing.T) {
	store, err := NewChatStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	resource := ChatScope{Type: ChatScopeResource, ID: "geo-1"}
	draft := ChatScope{Type: ChatScopeDraft, ID: "draft-1"}
	resourceSession, err := store.AppendScope("project-1", resource, Message{Role: "user", Content: "Review the processed Geometry."})
	if err != nil {
		t.Fatal(err)
	}
	draftSession, err := store.AppendScope("project-1", draft, Message{Role: "user", Content: "Change the Draft parameters."})
	if err != nil {
		t.Fatal(err)
	}
	if resourceSession.ID == draftSession.ID {
		t.Fatal("Draft and source Resource conversations share an ID")
	}
	if draftSession.ScopeType != ChatScopeDraft || draftSession.ScopeID != "draft-1" {
		t.Fatalf("unexpected Draft identity: %#v", draftSession)
	}
	loadedResource, err := store.GetScope("project-1", resource)
	if err != nil {
		t.Fatal(err)
	}
	if loadedResource.Messages[0].Content != "Review the processed Geometry." {
		t.Fatalf("Resource transcript leaked across scopes: %#v", loadedResource)
	}
}
