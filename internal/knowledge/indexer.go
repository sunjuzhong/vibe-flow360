package knowledge

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
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
		for end > 0 && !utf8.RuneStart(text[end]) {
			end--
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
		digest := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%s\x00%d\x00%s", chunks[i].SourceType, sourceID, projectID, i, chunks[i].Content)))
		chunks[i].ID = fmt.Sprintf("kb-%s-%x", chunks[i].SourceType, digest[:12])
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
	var files []string
	err := filepath.WalkDir(docsDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(path), ".md") {
			files = append(files, path)
		}
		return nil
	})
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
		sourceID, relErr := filepath.Rel(docsDir, file)
		if relErr != nil {
			sourceID = filepath.Base(file)
		}
		chunks, err := s.ChunkText(text, SourceDoc, sourceID, projectID)
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
	return s.store.Upsert(ctx, chunk)
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
