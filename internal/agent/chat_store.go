package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	chatSessionSchemaVersion = 1
	maxChatMessages          = 100
	maxStoredMessageBytes    = 64 << 10
)

var ErrChatSessionNotFound = errors.New("chat session not found")

type ChatSession struct {
	SchemaVersion int       `json:"schema_version"`
	ID            string    `json:"id"`
	ProjectID     string    `json:"project_id"`
	ResourceID    string    `json:"resource_id,omitempty"`
	Messages      []Message `json:"messages"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ChatStore persists one continuing conversation for each project/resource
// scope. Project-level chat uses an empty resource ID and is kept separate from
// every resource-level conversation.
type ChatStore struct {
	dir string
	mu  sync.RWMutex
}

func NewChatStore(dir string) (*ChatStore, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, errors.New("chat store directory is required")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create chat store: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, fmt.Errorf("secure chat store: %w", err)
	}
	return &ChatStore{dir: dir}, nil
}

func (s *ChatStore) Get(projectID, resourceID string) (ChatSession, error) {
	if err := validateChatScope(projectID, resourceID); err != nil {
		return ChatSession{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.read(projectID, resourceID)
}

func (s *ChatStore) Append(projectID, resourceID string, messages ...Message) (ChatSession, error) {
	if err := validateChatScope(projectID, resourceID); err != nil {
		return ChatSession{}, err
	}
	for _, message := range messages {
		if err := validateStoredMessage(message); err != nil {
			return ChatSession{}, err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	session, err := s.read(projectID, resourceID)
	if errors.Is(err, ErrChatSessionNotFound) {
		session = ChatSession{
			SchemaVersion: chatSessionSchemaVersion,
			ID:            chatScopeID(projectID, resourceID),
			ProjectID:     projectID,
			ResourceID:    resourceID,
			Messages:      []Message{},
			CreatedAt:     now,
		}
	} else if err != nil {
		return ChatSession{}, err
	}
	session.Messages = append(session.Messages, messages...)
	if len(session.Messages) > maxChatMessages {
		session.Messages = append([]Message(nil), session.Messages[len(session.Messages)-maxChatMessages:]...)
	}
	session.UpdatedAt = now
	if err := s.write(session); err != nil {
		return ChatSession{}, err
	}
	return cloneChatSession(session), nil
}

func (s *ChatStore) read(projectID, resourceID string) (ChatSession, error) {
	target := filepath.Join(s.dir, chatScopeID(projectID, resourceID)+".json")
	payload, err := os.ReadFile(target)
	if os.IsNotExist(err) {
		return ChatSession{}, ErrChatSessionNotFound
	}
	if err != nil {
		return ChatSession{}, err
	}
	var session ChatSession
	if err := json.Unmarshal(payload, &session); err != nil {
		return ChatSession{}, fmt.Errorf("decode chat session: %w", err)
	}
	if session.SchemaVersion != chatSessionSchemaVersion || session.ID != chatScopeID(projectID, resourceID) ||
		session.ProjectID != projectID || session.ResourceID != resourceID {
		return ChatSession{}, errors.New("stored chat session identity is invalid")
	}
	for _, message := range session.Messages {
		if err := validateStoredMessage(message); err != nil {
			return ChatSession{}, fmt.Errorf("stored chat session is invalid: %w", err)
		}
	}
	return cloneChatSession(session), nil
}

func (s *ChatStore) write(session ChatSession) error {
	payload, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(s.dir, ".chat-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(payload); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, filepath.Join(s.dir, session.ID+".json"))
}

func chatScopeID(projectID, resourceID string) string {
	digest := sha256.Sum256([]byte(projectID + "\x00" + resourceID))
	return "chat-" + hex.EncodeToString(digest[:16])
}

func validateChatScope(projectID, resourceID string) error {
	if strings.TrimSpace(projectID) == "" || len(projectID) > 200 || !utf8.ValidString(projectID) {
		return errors.New("project_id is invalid")
	}
	if len(resourceID) > 200 || !utf8.ValidString(resourceID) {
		return errors.New("resource_id is invalid")
	}
	return nil
}

func validateStoredMessage(message Message) error {
	if message.Role != "user" && message.Role != "assistant" {
		return errors.New("chat message role is invalid")
	}
	if strings.TrimSpace(message.Content) == "" || len(message.Content) > maxStoredMessageBytes || !utf8.ValidString(message.Content) {
		return errors.New("chat message content is invalid")
	}
	return nil
}

func cloneChatSession(session ChatSession) ChatSession {
	session.Messages = append([]Message(nil), session.Messages...)
	return session
}
