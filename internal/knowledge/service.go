package knowledge

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"time"
)

type KBService struct {
	client      *HelixClient
	embedder    *Embedder
	dataDir     string
	mu          sync.Mutex
	lastIndexed time.Time
}

func NewKBService(dataDir string) (*KBService, error) {
	if dataDir == "" {
		dataDir = ".vibesim"
	}
	client, err := NewHelixClient("")
	if err != nil {
		return nil, fmt.Errorf("create HelixDB client: %w", err)
	}
	embedder := NewEmbedder()
	svc := &KBService{
		client:   client,
		embedder: embedder,
		dataDir:  dataDir,
	}
	return svc, nil
}

func (s *KBService) Init(ctx context.Context) error {
	if !s.embedder.Ready() {
		return fmt.Errorf("embedding provider not configured")
	}
	if err := s.client.EnsureSchema(ctx); err != nil {
		return fmt.Errorf("ensure schema: %w", err)
	}
	return nil
}

func (s *KBService) Close() error {
	return s.client.Close()
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
	docsDir := filepath.Join("docs", "en")
	tutorialsDir := "tutorials"
	_, _, err := s.IndexDocs(ctx, docsDir, projectID)
	if err != nil {
		return fmt.Errorf("index docs: %w", err)
	}
	_, _, err = s.IndexTutorials(ctx, tutorialsDir, projectID)
	if err != nil {
		return fmt.Errorf("index tutorials: %w", err)
	}
	_, _, err = s.IndexChatMessages(ctx, messages, projectID)
	if err != nil {
		return fmt.Errorf("index chat: %w", err)
	}
	s.lastIndexed = time.Now().UTC()
	return nil
}

func (s *KBService) Status() (KBStatus, error) {
	return KBStatus{
		Ready:        s.embedder.Ready(),
		HelixURL:     s.client.URL(),
		LastIndexedAt: s.lastIndexed,
	}, nil
}