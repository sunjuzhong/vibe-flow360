package knowledge

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
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

func TestChunkTextPreservesUTF8(t *testing.T) {
	svc := &KBService{}
	chunks, err := svc.ChunkText(strings.Repeat("收敛曲线需要检查残差与升阻力。", 80), SourceDoc, "cn.md", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, chunk := range chunks {
		if strings.ContainsRune(chunk.Content, '\uFFFD') || !utf8.ValidString(chunk.Content) {
			t.Fatalf("invalid UTF-8 chunk: %q", chunk.Content)
		}
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
	t.Setenv("VIBESIM_KNOWLEDGE_BACKEND", "local")
	t.Setenv("VIBESIM_EMBEDDING_PROVIDER", "local")
	svc, err := NewKBService("")
	if err != nil {
		t.Fatalf("default local knowledge service: %v", err)
	}
	if svc == nil {
		t.Fatal("expected non-nil KBService")
	}
	svc.Close()
}

func TestLocalKnowledgeStorePersistsAndScopesResults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "knowledge", "index.json")
	store, err := NewLocalStore(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := store.Init(ctx); err != nil {
		t.Fatal(err)
	}
	embedder := NewLocalEmbedder()
	docVector, _ := embedder.GenerateEmbedding("Flow360 convergence residuals")
	chatVector, _ := embedder.GenerateEmbedding("private project discussion")
	for _, chunk := range []Chunk{
		{ID: "doc", Content: "Flow360 convergence residuals", SourceType: SourceDoc, Embedding: docVector},
		{ID: "chat-a", Content: "private project discussion", SourceType: SourceChat, ProjectID: "project-a", Embedding: chatVector},
	} {
		if err := store.Upsert(ctx, chunk); err != nil {
			t.Fatal(err)
		}
	}

	reopened, err := NewLocalStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.Init(ctx); err != nil {
		t.Fatal(err)
	}
	docs, err := reopened.Search(ctx, SourceDoc, docVector, "project-b", 5)
	if err != nil || len(docs) != 1 || docs[0].ID != "doc" {
		t.Fatalf("global docs unavailable after reopen: %#v, %v", docs, err)
	}
	if len(docs[0].Embedding) != 0 {
		t.Fatal("retrieval response must not expose internal embedding vectors")
	}
	chats, err := reopened.Search(ctx, SourceChat, chatVector, "project-b", 5)
	if err != nil || len(chats) != 0 {
		t.Fatalf("cross-project chat leaked: %#v, %v", chats, err)
	}
	chat, docsCount, tutorials := reopened.Stats()
	if chat != 1 || docsCount != 1 || tutorials != 0 {
		t.Fatalf("unexpected stats: chat=%d docs=%d tutorials=%d", chat, docsCount, tutorials)
	}
}

func TestLocalEmbedderRanksRelatedText(t *testing.T) {
	embedder := NewLocalEmbedder()
	query, _ := embedder.GenerateEmbedding("检查收敛残差")
	related, _ := embedder.GenerateEmbedding("如何检查收敛残差曲线")
	unrelated, _ := embedder.GenerateEmbedding("创建新的机翼几何")
	if cosineDistance(query, related) >= cosineDistance(query, unrelated) {
		t.Fatal("expected related CFD text to rank ahead of unrelated text")
	}
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
