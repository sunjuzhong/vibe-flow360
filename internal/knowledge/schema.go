package knowledge

import (
	"context"
	"fmt"

	helix "github.com/helixdb/helix-db/sdks/go"
)

func (c *HelixClient) EnsureSchema(ctx context.Context) error {
	indexConfigs := []struct {
		label       string
		property    string
		dimension   uint
		tenantField string
	}{
		{"ChatChunk", "embedding", 1536, "projectId"},
		{"DocChunk", "embedding", 1536, "projectId"},
		{"TutorialChunk", "embedding", 1536, "projectId"},
	}
	for _, cfg := range indexConfigs {
		req := helix.WriteQuery("").
			VarAs("idx",
				helix.G().CreateVectorIndexNodes(cfg.label, cfg.property, cfg.dimension, helix.VectorDistanceCosine, cfg.tenantField),
			).Returning("idx")
		var out struct {
			Idx any `json:"idx"`
		}
		if err := c.Exec(ctx, req, &out); err != nil {
			return fmt.Errorf("create vector index for %s: %w", cfg.label, err)
		}
	}
	return nil
}