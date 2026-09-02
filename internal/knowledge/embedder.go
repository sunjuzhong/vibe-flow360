package knowledge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	defaultEmbeddingModelEnv = "VIBESIM_EMBEDDING_MODEL"
	defaultEmbeddingModel  = "text-embedding-3-small"
	embeddingMaxBatchSize  = 100
)

type Embedder struct {
	apiKey    string
	baseURL   string
	model     string
	httpClient *http.Client
}

func NewEmbedder() *Embedder {
	model := os.Getenv(defaultEmbeddingModelEnv)
	if model == "" {
		model = defaultEmbeddingModel
	}
	return &Embedder{
		apiKey:    firstNonEmpty(os.Getenv("VIBESIM_AI_API_KEY"), os.Getenv("OPENAI_API_KEY")),
		baseURL:   strings.TrimRight(firstNonEmpty(os.Getenv("VIBESIM_AI_BASE_URL"), "https://api.openai.com/v1"), "/"),
		model:     model,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

func (e *Embedder) Ready() bool {
	return e.apiKey != "" && e.model != ""
}

func (e *Embedder) GenerateEmbedding(text string) ([]float32, error) {
	embeddings, err := e.BatchGenerateEmbeddings([]string{text})
	if err != nil {
		return nil, err
	}
	if len(embeddings) == 0 {
		return nil, fmt.Errorf("no embedding returned")
	}
	return embeddings[0], nil
}

func (e *Embedder) BatchGenerateEmbeddings(texts []string) ([][]float32, error) {
	if !e.Ready() {
		return nil, fmt.Errorf("embedding provider not configured: set VIBESIM_AI_API_KEY")
	}
	if len(texts) == 0 {
		return nil, nil
	}

	type embeddingRequest struct {
		Model string   `json:"model"`
		Input []string `json:"input"`
	}
	type embeddingResponse struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	reqBody := embeddingRequest{
		Model: e.model,
		Input: texts,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal embedding request: %w", err)
	}

	url := e.baseURL + "/embeddings"
	httpReq, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create embedding request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+e.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := e.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("embedding request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("read embedding response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("embedding provider returned %s: %s", resp.Status, string(respBody))
	}

	var result embeddingResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode embedding response: %w", err)
	}
	if result.Error != nil {
		return nil, fmt.Errorf("embedding error: %s", result.Error.Message)
	}

	embeddings := make([][]float32, len(result.Data))
	for i, d := range result.Data {
		embeddings[i] = d.Embedding
	}
	return embeddings, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}