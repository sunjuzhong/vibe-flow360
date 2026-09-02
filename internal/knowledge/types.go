package knowledge

import (
	"time"
)

const (
	defaultChunkSize    = 500
	defaultChunkOverlap = 100
	defaultHelixURL     = "http://localhost:6969"
	defaultMaxChunks    = 50
)

type ChunkSourceType string

const (
	SourceChat     ChunkSourceType = "chat"
	SourceDoc      ChunkSourceType = "doc"
	SourceTutorial ChunkSourceType = "tutorial"
)

type Chunk struct {
	ID         string            `json:"id"`
	Content    string            `json:"content"`
	SourceType ChunkSourceType   `json:"source_type"`
	SourceID   string            `json:"source_id"`
	ProjectID  string            `json:"project_id"`
	CreatedAt  time.Time         `json:"created_at"`
	Embedding  []float32         `json:"embedding,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	Distance   float64           `json:"distance,omitempty"`
}

type KBStatus struct {
	Ready          bool      `json:"ready"`
	Backend        string    `json:"backend"`
	BackendURL     string    `json:"backend_url"`
	ChatChunks     int       `json:"chat_chunks"`
	DocChunks      int       `json:"doc_chunks"`
	TutorialChunks int       `json:"tutorial_chunks"`
	TotalChunks    int       `json:"total_chunks"`
	LastIndexedAt  time.Time `json:"last_indexed_at,omitempty"`
	HelixURL       string    `json:"helix_url,omitempty"`
}

type IndexResult struct {
	ProjectID string   `json:"project_id"`
	Indexed   int      `json:"indexed"`
	Skipped   int      `json:"skipped"`
	Errors    []string `json:"errors,omitempty"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
