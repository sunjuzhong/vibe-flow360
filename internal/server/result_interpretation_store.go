package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/sunjuzhong/vibe-flow360/internal/agent"
)

const (
	resultInterpretationSchemaVersion = 1
	maxResultConversationMessages     = 40
	maxResultStoredMessageBytes       = 64 << 10
)

var errResultInterpretationNotFound = errors.New("result interpretation not found")

type resultInterpretationRecord struct {
	SchemaVersion  int             `json:"schema_version"`
	Key            string          `json:"key"`
	Scope          string          `json:"scope"`
	Path           string          `json:"path"`
	Language       string          `json:"language"`
	Provider       string          `json:"provider"`
	Model          string          `json:"model"`
	PromptVersion  string          `json:"prompt_version"`
	Interpretation string          `json:"interpretation"`
	Messages       []agent.Message `json:"messages"`
	GeneratedAt    time.Time       `json:"generated_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

type resultInterpretationStore struct {
	dir string
	mu  sync.RWMutex
}

func newResultInterpretationStore(dir string) (*resultInterpretationStore, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, errors.New("result interpretation store directory is required")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create result interpretation store: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, fmt.Errorf("secure result interpretation store: %w", err)
	}
	return &resultInterpretationStore{dir: dir}, nil
}

func (s *resultInterpretationStore) get(key string) (resultInterpretationRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.read(key)
}

func (s *resultInterpretationStore) put(record resultInterpretationRecord) error {
	if err := validateResultInterpretationRecord(record); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.write(record)
}

func (s *resultInterpretationStore) write(record resultInterpretationRecord) error {
	payload, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(s.dir, ".result-ai-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, filepath.Join(s.dir, record.Key+".json"))
}

func (s *resultInterpretationStore) clearMessages(key string) (resultInterpretationRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := s.read(key)
	if err != nil {
		return resultInterpretationRecord{}, err
	}
	record.Messages = []agent.Message{}
	record.UpdatedAt = time.Now().UTC()
	if err := s.write(record); err != nil {
		return resultInterpretationRecord{}, err
	}
	return record, nil
}

func (s *resultInterpretationStore) read(key string) (resultInterpretationRecord, error) {
	if !validResultInterpretationKey(key) {
		return resultInterpretationRecord{}, errors.New("invalid result interpretation key")
	}
	payload, err := os.ReadFile(filepath.Join(s.dir, key+".json"))
	if os.IsNotExist(err) {
		return resultInterpretationRecord{}, errResultInterpretationNotFound
	}
	if err != nil {
		return resultInterpretationRecord{}, err
	}
	var record resultInterpretationRecord
	if err := json.Unmarshal(payload, &record); err != nil {
		return resultInterpretationRecord{}, fmt.Errorf("decode result interpretation: %w", err)
	}
	if record.Key != key {
		return resultInterpretationRecord{}, errors.New("stored result interpretation identity is invalid")
	}
	if err := validateResultInterpretationRecord(record); err != nil {
		return resultInterpretationRecord{}, fmt.Errorf("stored result interpretation is invalid: %w", err)
	}
	return record, nil
}

func validateResultInterpretationRecord(record resultInterpretationRecord) error {
	if record.SchemaVersion != resultInterpretationSchemaVersion || !validResultInterpretationKey(record.Key) {
		return errors.New("invalid result interpretation identity")
	}
	if strings.TrimSpace(record.Scope) == "" || len(record.Scope) > 512 {
		return errors.New("invalid result interpretation scope")
	}
	if strings.TrimSpace(record.Interpretation) == "" || len(record.Interpretation) > maxResultStoredMessageBytes || !utf8.ValidString(record.Interpretation) {
		return errors.New("invalid result interpretation content")
	}
	if len(record.Messages) > maxResultConversationMessages {
		return errors.New("too many result conversation messages")
	}
	for _, message := range record.Messages {
		if (message.Role != "user" && message.Role != "assistant") || strings.TrimSpace(message.Content) == "" || len(message.Content) > maxResultStoredMessageBytes || !utf8.ValidString(message.Content) {
			return errors.New("invalid result conversation message")
		}
	}
	return nil
}

func validResultInterpretationKey(key string) bool {
	if len(key) != len("result-")+64 || !strings.HasPrefix(key, "result-") {
		return false
	}
	for _, char := range key[len("result-"):] {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}
