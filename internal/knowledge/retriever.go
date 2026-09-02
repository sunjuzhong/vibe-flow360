package knowledge

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

func (s *KBService) RetrieveContext(ctx context.Context, query string, projectID string, limit int) ([]Chunk, error) {
	if limit <= 0 {
		limit = defaultMaxChunks
	}
	vector, err := s.embedder.GenerateEmbedding(query)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}
	var allChunks []Chunk
	for _, sourceType := range []ChunkSourceType{SourceChat, SourceDoc, SourceTutorial} {
		chunks, err := s.store.Search(ctx, sourceType, vector, projectID, limit)
		if err != nil {
			continue
		}
		allChunks = append(allChunks, chunks...)
	}
	allChunks = dedupChunks(allChunks)
	sort.SliceStable(allChunks, func(i, j int) bool { return allChunks[i].Distance < allChunks[j].Distance })
	if len(allChunks) > limit {
		allChunks = allChunks[:limit]
	}
	return allChunks, nil
}

func dedupChunks(chunks []Chunk) []Chunk {
	seen := make(map[string]bool)
	var result []Chunk
	for _, c := range chunks {
		if !seen[c.ID] {
			seen[c.ID] = true
			result = append(result, c)
		}
	}
	return result
}

func (s *KBService) FormatContext(chunks []Chunk) string {
	if len(chunks) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("## Retrieved Knowledge\n\n")
	for i, chunk := range chunks {
		sb.WriteString(fmt.Sprintf("[%s] %s", chunk.SourceType, chunk.Content))
		if i < len(chunks)-1 {
			sb.WriteString("\n\n")
		}
	}
	return sb.String()
}
