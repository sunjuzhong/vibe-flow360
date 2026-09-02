package knowledge

import (
	"context"
	"fmt"
	"time"

	helix "github.com/helixdb/helix-db/sdks/go"
)

func (c *HelixClient) Upsert(ctx context.Context, chunk Chunk) error {
	req := helix.WriteQuery("").
		VarAs("node",
			helix.G().AddN(chunk.sourceLabel(), helix.Props{
				helix.Prop("id", chunk.ID),
				helix.Prop("content", chunk.Content),
				helix.Prop("sourceType", string(chunk.SourceType)),
				helix.Prop("sourceId", chunk.SourceID),
				helix.Prop("projectId", chunk.ProjectID),
				helix.Prop("createdAt", chunk.CreatedAt.Format(time.RFC3339)),
				helix.Prop("embedding", chunk.Embedding),
			}),
		).Returning("node")
	var out struct {
		Node any `json:"node"`
	}
	return c.Exec(ctx, req, &out)
}

func (c *HelixClient) Search(ctx context.Context, sourceType ChunkSourceType, queryVector []float32, projectID string, limit int) ([]Chunk, error) {
	label := (Chunk{SourceType: sourceType}).sourceLabel()
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
	if err := c.Exec(ctx, req, &out); err != nil {
		return nil, fmt.Errorf("vector search %s: %w", label, err)
	}

	chunks := make([]Chunk, len(out.Hits))
	for i, hit := range out.Hits {
		chunks[i] = Chunk{
			ID: hit.ID, Content: hit.Content, SourceType: ChunkSourceType(hit.SourceType),
			SourceID: hit.SourceID, ProjectID: hit.ProjectID, Distance: hit.Distance,
		}
		if hit.CreatedAt != "" {
			if createdAt, err := time.Parse(time.RFC3339, hit.CreatedAt); err == nil {
				chunks[i].CreatedAt = createdAt
			}
		}
	}
	return chunks, nil
}
