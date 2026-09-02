package knowledge

import (
	"context"
	"fmt"
	"strings"
	"time"

	helix "github.com/helixdb/helix-db/sdks/go"
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
	for _, label := range []string{"ChatChunk", "DocChunk", "TutorialChunk"} {
		chunks, err := s.retrieveByLabel(ctx, label, vector, projectID, limit)
		if err != nil {
			continue
		}
		allChunks = append(allChunks, chunks...)
	}
	allChunks = dedupChunks(allChunks)
	return allChunks, nil
}

func (s *KBService) retrieveByLabel(ctx context.Context, label string, queryVector []float32, projectID string, limit int) ([]Chunk, error) {
	q := helix.ReadQuery("retrieve_chunks")
	vectorParam := q.ParamArray("query_vector", queryVector, helix.ParamTypeF32())
	limitParam := q.ParamI64("limit", int64(limit))
	tenantInput := helix.ParamInput("project_id")

	req := q.
		VarAs("hits",
			helix.G().
				VectorSearchNodesWith(label, "embedding", vectorParam.Input(), limitParam.Bound(), &tenantInput).
				Project(
					helix.ProjectPropAs("$id", "id"),
					helix.ProjectPropAs("content", "content"),
					helix.ProjectPropAs("sourceType", "sourceType"),
					helix.ProjectPropAs("sourceId", "sourceId"),
					helix.ProjectPropAs("projectId", "projectId"),
					helix.ProjectPropAs("createdAt", "createdAt"),
					helix.ProjectPropAs("$distance", "distance"),
				),
		).Returning("hits")

	var out struct {
		Hits []struct {
			ID         string  `json:"id"`
			Content    string  `json:"content"`
			SourceType string  `json:"sourceType"`
			SourceID   string  `json:"sourceId"`
			ProjectID  string  `json:"projectId"`
			CreatedAt  string  `json:"createdAt"`
			Distance   float64 `json:"distance"`
		} `json:"hits"`
	}
	if err := s.client.Exec(ctx, req, &out); err != nil {
		return nil, fmt.Errorf("vector search %s: %w", label, err)
	}

	chunks := make([]Chunk, len(out.Hits))
	for i, h := range out.Hits {
		chunks[i] = Chunk{
			ID:         h.ID,
			Content:    h.Content,
			SourceType: ChunkSourceType(h.SourceType),
			SourceID:   h.SourceID,
			ProjectID:  h.ProjectID,
			Distance:   h.Distance,
		}
		if h.CreatedAt != "" {
			if t, err := time.Parse(time.RFC3339, h.CreatedAt); err == nil {
				chunks[i].CreatedAt = t
			}
		}
	}
	return chunks, nil
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