package knowledge

import "context"

// VectorStore is the persistence boundary used by the knowledge service.
// Implementations are responsible for schema setup, tenant-scoped storage,
// and vector similarity search.
type VectorStore interface {
	Init(context.Context) error
	Upsert(context.Context, Chunk) error
	Search(context.Context, ChunkSourceType, []float32, string, int) ([]Chunk, error)
	Close() error
	Backend() string
	URL() string
}

// EmbeddingProvider is the model boundary used by the knowledge service.
type EmbeddingProvider interface {
	Ready() bool
	GenerateEmbedding(string) ([]float32, error)
}

type storeStatsProvider interface {
	Stats() (chat, docs, tutorials int)
}
