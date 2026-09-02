package knowledge

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	helix "github.com/helixdb/helix-db/sdks/go"
)

func (s *KBService) ChunkText(text string, sourceType ChunkSourceType, sourceID, projectID string) ([]Chunk, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	var chunks []Chunk
	for len(text) > defaultChunkSize {
		end := defaultChunkSize
		for end > defaultChunkSize-defaultChunkOverlap && !isBoundary(text[end]) {
			end--
		}
		if end == defaultChunkSize-defaultChunkOverlap {
			end = defaultChunkSize
		}
		chunkText := strings.TrimSpace(text[:end])
		chunks = append(chunks, Chunk{
			Content:    chunkText,
			SourceType: sourceType,
			SourceID:   sourceID,
			ProjectID:  projectID,
			CreatedAt:  time.Now().UTC(),
			Metadata:   map[string]string{},
		})
		text = text[end:]
	}
	if len(text) > 0 {
		chunks = append(chunks, Chunk{
			Content:    strings.TrimSpace(text),
			SourceType: sourceType,
			SourceID:   sourceID,
			ProjectID:  projectID,
			CreatedAt:  time.Now().UTC(),
			Metadata:   map[string]string{},
		})
	}
	if len(chunks) > defaultMaxChunks {
		chunks = chunks[len(chunks)-defaultMaxChunks:]
	}
	for i := range chunks {
		chunks[i].ID = fmt.Sprintf("kb-%s-%d-%d", chunks[i].SourceType, chunks[i].CreatedAt.UnixNano(), i)
	}
	return chunks, nil
}

func isBoundary(b byte) bool {
	return b == ' ' || b == '\n' || b == '.' || b == ',' || b == ';' || b == '\r' || b == '\t'
}

func (s *KBService) IndexChatMessages(ctx context.Context, messages []Message, projectID string) (int, []string, error) {
	var indexed int
	var errs []string
	for _, msg := range messages {
		if strings.TrimSpace(msg.Content) == "" {
			continue
		}
		chunks, err := s.ChunkText(msg.Content, SourceChat, "chat", projectID)
		if err != nil {
			errs = append(errs, fmt.Sprintf("chunk message: %v", err))
			continue
		}
		for _, chunk := range chunks {
			embedding, err := s.embedder.GenerateEmbedding(chunk.Content)
			if err != nil {
				errs = append(errs, fmt.Sprintf("embed: %v", err))
				continue
			}
			chunk.Embedding = embedding
			if err := s.insertChunk(ctx, chunk); err != nil {
				errs = append(errs, fmt.Sprintf("insert chunk: %v", err))
				continue
			}
			indexed++
		}
	}
	return indexed, errs, nil
}

func (s *KBService) IndexDocs(ctx context.Context, docsDir, projectID string) (int, []string, error) {
	files, err := filepath.Glob(filepath.Join(docsDir, "**/*.md"))
	if err != nil {
		return 0, nil, fmt.Errorf("find doc files: %w", err)
	}
	var indexed int
	var errs []string
	for _, file := range files {
		content, err := os.ReadFile(file)
		if err != nil {
			errs = append(errs, fmt.Sprintf("read %s: %v", file, err))
			continue
		}
		text := string(content)
		chunks, err := s.ChunkText(text, SourceDoc, filepath.Base(file), projectID)
		if err != nil {
			errs = append(errs, fmt.Sprintf("chunk %s: %v", file, err))
			continue
		}
		for _, chunk := range chunks {
			embedding, err := s.embedder.GenerateEmbedding(chunk.Content)
			if err != nil {
				errs = append(errs, fmt.Sprintf("embed: %v", err))
				continue
			}
			chunk.Embedding = embedding
			if err := s.insertChunk(ctx, chunk); err != nil {
				errs = append(errs, fmt.Sprintf("insert chunk: %v", err))
				continue
			}
			indexed++
		}
	}
	return indexed, errs, nil
}

func (s *KBService) IndexTutorials(ctx context.Context, tutorialsDir, projectID string) (int, []string, error) {
	entries, err := os.ReadDir(tutorialsDir)
	if err != nil {
		return 0, nil, fmt.Errorf("read tutorials dir: %w", err)
	}
	var indexed int
	var errs []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		tutorialDir := filepath.Join(tutorialsDir, entry.Name())
		metaPath := filepath.Join(tutorialDir, "README.md")
		content, err := os.ReadFile(metaPath)
		if err != nil {
			continue
		}
		text := string(content)
		chunks, err := s.ChunkText(text, SourceTutorial, entry.Name(), projectID)
		if err != nil {
			errs = append(errs, fmt.Sprintf("chunk %s: %v", entry.Name(), err))
			continue
		}
		for _, chunk := range chunks {
			embedding, err := s.embedder.GenerateEmbedding(chunk.Content)
			if err != nil {
				errs = append(errs, fmt.Sprintf("embed: %v", err))
				continue
			}
			chunk.Embedding = embedding
			if err := s.insertChunk(ctx, chunk); err != nil {
				errs = append(errs, fmt.Sprintf("insert chunk: %v", err))
				continue
			}
			indexed++
		}
	}
	return indexed, errs, nil
}

func (s *KBService) insertChunk(ctx context.Context, chunk Chunk) error {
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
	return s.client.Exec(ctx, req, &out)
}

func (c Chunk) sourceLabel() string {
	switch c.SourceType {
	case SourceChat:
		return "ChatChunk"
	case SourceDoc:
		return "DocChunk"
	case SourceTutorial:
		return "TutorialChunk"
	default:
		return "ChatChunk"
	}
}