package knowledge

import (
	"context"
	"fmt"

	helix "github.com/helixdb/helix-db/sdks/go"
)

type HelixClient struct {
	client *helix.Client
}

func NewHelixClient(baseURL string) (*HelixClient, error) {
	if baseURL == "" {
		baseURL = defaultHelixURL
	}
	client, err := helix.NewClient(baseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create HelixDB client: %w", err)
	}
	return &HelixClient{client: client}, nil
}

func (c *HelixClient) Exec(ctx context.Context, req helix.Request, out any) error {
	return c.client.Exec(ctx, req, out)
}

func (c *HelixClient) Close() error {
	return c.client.Close()
}

func (c *HelixClient) URL() string {
	return c.client.BaseURL()
}

func (c *HelixClient) Backend() string {
	return "helixdb"
}
