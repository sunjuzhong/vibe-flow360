package knowledge

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type KBService struct {
	store       VectorStore
	embedder    EmbeddingProvider
	dataDir     string
	mu          sync.Mutex
	lastIndexed time.Time
}

func NewKBService(dataDir string) (*KBService, error) {
	if dataDir == "" {
		dataDir = ".vibesim"
	}
	var store VectorStore
	switch strings.ToLower(strings.TrimSpace(os.Getenv("VIBESIM_KNOWLEDGE_BACKEND"))) {
	case "", "local":
		local, err := NewLocalStore(filepath.Join(dataDir, "index.json"))
		if err != nil {
			return nil, fmt.Errorf("create local knowledge store: %w", err)
		}
		store = local
	case "helix", "helixdb":
		client, err := NewHelixClient(strings.TrimSpace(os.Getenv("VIBESIM_HELIX_URL")))
		if err != nil {
			return nil, fmt.Errorf("create HelixDB client: %w", err)
		}
		store = client
	default:
		return nil, fmt.Errorf("unsupported knowledge backend %q; use local or helixdb", os.Getenv("VIBESIM_KNOWLEDGE_BACKEND"))
	}

	var embedder EmbeddingProvider
	switch strings.ToLower(strings.TrimSpace(os.Getenv("VIBESIM_EMBEDDING_PROVIDER"))) {
	case "", "local":
		embedder = NewLocalEmbedder()
	case "openai":
		embedder = NewEmbedder()
	default:
		_ = store.Close()
		return nil, fmt.Errorf("unsupported embedding provider %q; use local or openai", os.Getenv("VIBESIM_EMBEDDING_PROVIDER"))
	}

	svc, err := NewKBServiceWithDependencies(dataDir, store, embedder)
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	return svc, nil
}

// NewKBServiceWithDependencies constructs the orchestration service against
// interfaces so another vector database or embedding provider can be plugged
// in without changing indexing, retrieval, or chat integration code.
func NewKBServiceWithDependencies(dataDir string, store VectorStore, embedder EmbeddingProvider) (*KBService, error) {
	if store == nil {
		return nil, fmt.Errorf("vector store is required")
	}
	if embedder == nil {
		return nil, fmt.Errorf("embedding provider is required")
	}
	if dataDir == "" {
		dataDir = ".vibesim"
	}
	return &KBService{store: store, embedder: embedder, dataDir: dataDir}, nil
}

func (s *KBService) Init(ctx context.Context) error {
	if !s.embedder.Ready() {
		return fmt.Errorf("embedding provider not configured")
	}
	if err := s.store.Init(ctx); err != nil {
		return fmt.Errorf("initialize vector store: %w", err)
	}
	return nil
}

func (s *KBService) Close() error {
	return s.store.Close()
}

func (s *KBService) BuildContextForChat(query string, projectID string) (string, error) {
	ctx := context.Background()
	chunks, err := s.RetrieveContext(ctx, query, projectID, defaultMaxChunks)
	if err != nil {
		return "", err
	}
	if len(chunks) == 0 {
		return "", nil
	}
	return s.FormatContext(chunks), nil
}

func (s *KBService) RebuildIndex(projectID string, messages []Message) error {
	ctx := context.Background()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.Init(ctx); err != nil {
		return err
	}
	if err := s.indexDefaultCorpus(ctx, projectID); err != nil {
		return err
	}
	_, _, err := s.IndexChatMessages(ctx, messages, projectID)
	if err != nil {
		return fmt.Errorf("index chat: %w", err)
	}
	s.lastIndexed = time.Now().UTC()
	return nil
}

func (s *KBService) IndexDefaultCorpus(projectID string) error {
	ctx := context.Background()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.Init(ctx); err != nil {
		return err
	}
	if err := s.indexDefaultCorpus(ctx, projectID); err != nil {
		return err
	}
	s.lastIndexed = time.Now().UTC()
	return nil
}

func (s *KBService) indexDefaultCorpus(ctx context.Context, projectID string) error {
	docsDir := firstNonEmpty(os.Getenv("VIBESIM_KNOWLEDGE_DOCS_DIR"), filepath.Join("docs", "en"))
	tutorialsDir := firstNonEmpty(os.Getenv("VIBESIM_KNOWLEDGE_TUTORIALS_DIR"), "tutorials")
	_, _, err := s.IndexDocs(ctx, docsDir, projectID)
	if err != nil {
		return fmt.Errorf("index docs: %w", err)
	}
	_, _, err = s.IndexTutorials(ctx, tutorialsDir, projectID)
	if err != nil {
		return fmt.Errorf("index tutorials: %w", err)
	}
	return nil
}

func (s *KBService) IndexMessages(projectID string, messages []Message) error {
	ctx := context.Background()
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _, err := s.IndexChatMessages(ctx, messages, projectID)
	return err
}

func (s *KBService) Status() (KBStatus, error) {
	status := KBStatus{
		Ready:         s.embedder.Ready(),
		Backend:       s.store.Backend(),
		BackendURL:    s.store.URL(),
		HelixURL:      helixURL(s.store),
		LastIndexedAt: s.lastIndexed,
	}
	if stats, ok := s.store.(storeStatsProvider); ok {
		status.ChatChunks, status.DocChunks, status.TutorialChunks = stats.Stats()
		status.TotalChunks = status.ChatChunks + status.DocChunks + status.TutorialChunks
	}
	return status, nil
}

func helixURL(store VectorStore) string {
	if store.Backend() == "helixdb" {
		return store.URL()
	}
	return ""
}
