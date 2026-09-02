package knowledge

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

type LocalStore struct {
	path   string
	mu     sync.RWMutex
	chunks map[string]Chunk
}

func NewLocalStore(path string) (*LocalStore, error) {
	if path == "" {
		return nil, fmt.Errorf("local knowledge store path is required")
	}
	return &LocalStore{path: path, chunks: make(map[string]Chunk)}, nil
}

func (s *LocalStore) Init(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return os.MkdirAll(filepath.Dir(s.path), 0o700)
	}
	if err != nil {
		return err
	}
	var chunks []Chunk
	if err := json.Unmarshal(data, &chunks); err != nil {
		return fmt.Errorf("decode local knowledge index: %w", err)
	}
	for _, chunk := range chunks {
		s.chunks[chunk.ID] = chunk
	}
	return nil
}

func (s *LocalStore) Upsert(_ context.Context, chunk Chunk) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.chunks[chunk.ID] = chunk
	return s.persistLocked()
}

func (s *LocalStore) Search(_ context.Context, sourceType ChunkSourceType, query []float32, projectID string, limit int) ([]Chunk, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	results := make([]Chunk, 0)
	for _, chunk := range s.chunks {
		if chunk.SourceType != sourceType || !visibleToProject(chunk, projectID) {
			continue
		}
		chunk.Distance = cosineDistance(query, chunk.Embedding)
		chunk.Embedding = nil
		results = append(results, chunk)
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Distance < results[j].Distance })
	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

func visibleToProject(chunk Chunk, projectID string) bool {
	if chunk.SourceType == SourceDoc || chunk.SourceType == SourceTutorial {
		return chunk.ProjectID == "" || chunk.ProjectID == projectID
	}
	return chunk.ProjectID == projectID
}

func cosineDistance(left, right []float32) float64 {
	if len(left) == 0 || len(left) != len(right) {
		return 1
	}
	var dot, leftNorm, rightNorm float64
	for i := range left {
		dot += float64(left[i] * right[i])
		leftNorm += float64(left[i] * left[i])
		rightNorm += float64(right[i] * right[i])
	}
	if leftNorm == 0 || rightNorm == 0 {
		return 1
	}
	return 1 - dot/(math.Sqrt(leftNorm)*math.Sqrt(rightNorm))
}

func (s *LocalStore) persistLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	chunks := make([]Chunk, 0, len(s.chunks))
	for _, chunk := range s.chunks {
		chunks = append(chunks, chunk)
	}
	sort.Slice(chunks, func(i, j int) bool { return chunks[i].ID < chunks[j].ID })
	data, err := json.Marshal(chunks)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(s.path), ".knowledge-*.json")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, s.path)
}

func (*LocalStore) Close() error    { return nil }
func (*LocalStore) Backend() string { return "local" }
func (s *LocalStore) URL() string   { return s.path }

func (s *LocalStore) Stats() (chat, docs, tutorials int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, chunk := range s.chunks {
		switch chunk.SourceType {
		case SourceChat:
			chat++
		case SourceDoc:
			docs++
		case SourceTutorial:
			tutorials++
		}
	}
	return
}
