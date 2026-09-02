package knowledge

import (
	"context"
	"testing"
)

type fakeVectorStore struct {
	initialized bool
	upserted    []Chunk
	results     map[ChunkSourceType][]Chunk
}

func (s *fakeVectorStore) Init(context.Context) error {
	s.initialized = true
	return nil
}

func (s *fakeVectorStore) Upsert(_ context.Context, chunk Chunk) error {
	s.upserted = append(s.upserted, chunk)
	return nil
}

func (s *fakeVectorStore) Search(_ context.Context, sourceType ChunkSourceType, _ []float32, _ string, _ int) ([]Chunk, error) {
	return s.results[sourceType], nil
}

func (*fakeVectorStore) Close() error    { return nil }
func (*fakeVectorStore) Backend() string { return "fake" }
func (*fakeVectorStore) URL() string     { return "memory://knowledge" }

type fakeEmbeddingProvider struct{}

func (fakeEmbeddingProvider) Ready() bool { return true }
func (fakeEmbeddingProvider) GenerateEmbedding(string) ([]float32, error) {
	return []float32{0.1, 0.2}, nil
}

func TestChunkText(t *testing.T) {
	svc := &KBService{}
	chunks, err := svc.ChunkText("This is a test message that is longer than the default chunk size and should be split into multiple chunks.", SourceDoc, "test-id", "proj-1")
	if err != nil {
		t.Fatalf("ChunkText failed: %v", err)
	}
	if len(chunks) == 0 {
		t.Fatal("expected at least one chunk")
	}
	for _, c := range chunks {
		if c.Content == "" {
			t.Error("empty chunk content")
		}
		if c.SourceType != SourceDoc {
			t.Errorf("unexpected source type: %s", c.SourceType)
		}
	}
}

func TestChunkTextEmpty(t *testing.T) {
	svc := &KBService{}
	chunks, err := svc.ChunkText("", SourceChat, "test-id", "proj-1")
	if err != nil {
		t.Fatalf("ChunkText failed: %v", err)
	}
	if len(chunks) != 0 {
		t.Errorf("expected 0 chunks for empty text, got %d", len(chunks))
	}
}

func TestSourceLabel(t *testing.T) {
	tests := []struct {
		st  ChunkSourceType
		exp string
	}{
		{SourceChat, "ChatChunk"},
		{SourceDoc, "DocChunk"},
		{SourceTutorial, "TutorialChunk"},
		{"unknown", "ChatChunk"},
	}
	for _, tc := range tests {
		c := Chunk{SourceType: tc.st}
		if got := c.sourceLabel(); got != tc.exp {
			t.Errorf("sourceLabel(%s) = %s, want %s", tc.st, got, tc.exp)
		}
	}
}

func TestDedupChunks(t *testing.T) {
	chunks := []Chunk{
		{ID: "1", Content: "a"},
		{ID: "2", Content: "b"},
		{ID: "1", Content: "a"},
	}
	result := dedupChunks(chunks)
	if len(result) != 2 {
		t.Errorf("expected 2 chunks after dedup, got %d", len(result))
	}
}

func TestChunkTextMaxChunks(t *testing.T) {
	svc := &KBService{}
	longText := ""
	for i := 0; i < 60; i++ {
		longText += "This is a chunk of text that exceeds the default size limit by being quite long. "
	}
	chunks, err := svc.ChunkText(longText, SourceChat, "test-id", "proj-1")
	if err != nil {
		t.Fatalf("ChunkText failed: %v", err)
	}
	if len(chunks) > defaultMaxChunks {
		t.Errorf("expected at most %d chunks, got %d", defaultMaxChunks, len(chunks))
	}
}

func TestIndexChatMessagesEmpty(t *testing.T) {
	svc := &KBService{embedder: NewEmbedder()}
	_, _, err := svc.IndexChatMessages(context.Background(), nil, "proj-1")
	if err != nil {
		t.Fatalf("IndexChatMessages with nil messages failed: %v", err)
	}
}

func TestNewKBService(t *testing.T) {
	svc, err := NewKBService("")
	if err != nil {
		t.Skipf("HelixDB not available: %v", err)
	}
	if svc == nil {
		t.Fatal("expected non-nil KBService")
	}
	svc.Close()
}

func TestKBServiceUsesInjectedVectorStore(t *testing.T) {
	store := &fakeVectorStore{results: map[ChunkSourceType][]Chunk{
		SourceDoc: {{ID: "doc-1", Content: "Flow360 reference", SourceType: SourceDoc}},
	}}
	svc, err := NewKBServiceWithDependencies("", store, fakeEmbeddingProvider{})
	if err != nil {
		t.Fatalf("NewKBServiceWithDependencies failed: %v", err)
	}
	if err := svc.Init(context.Background()); err != nil {
		t.Fatalf("Init failed: %v", err)
	}
	if !store.initialized {
		t.Fatal("expected injected vector store to be initialized")
	}

	chunks, err := svc.RetrieveContext(context.Background(), "query", "project-1", 5)
	if err != nil {
		t.Fatalf("RetrieveContext failed: %v", err)
	}
	if len(chunks) != 1 || chunks[0].ID != "doc-1" {
		t.Fatalf("unexpected chunks: %#v", chunks)
	}

	status, err := svc.Status()
	if err != nil {
		t.Fatalf("Status failed: %v", err)
	}
	if status.Backend != "fake" || status.BackendURL != "memory://knowledge" || status.HelixURL != "" {
		t.Fatalf("unexpected backend status: %#v", status)
	}
}

func TestNewKBServiceWithDependenciesRequiresDependencies(t *testing.T) {
	if _, err := NewKBServiceWithDependencies("", nil, fakeEmbeddingProvider{}); err == nil {
		t.Fatal("expected missing vector store error")
	}
	if _, err := NewKBServiceWithDependencies("", &fakeVectorStore{}, nil); err == nil {
		t.Fatal("expected missing embedding provider error")
	}
}
