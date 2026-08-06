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
	ScopeType     string    `json:"scope_type,omitempty"`
	ScopeID       string    `json:"scope_id,omitempty"`
	Messages      []Message `json:"messages"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

const (
	ChatScopeProject  = "project"
	ChatScopeResource = "resource"
	ChatScopeDraft    = "draft"
)

type ChatScope struct {
	Type string
	ID   string
}

func ResolveChatScope(scopeType, scopeID, resourceID string) (ChatScope, error) {
	scopeType = strings.ToLower(strings.TrimSpace(scopeType))
	scopeID = strings.TrimSpace(scopeID)
	resourceID = strings.TrimSpace(resourceID)
	if scopeType == "" {
		if resourceID == "" {
			scopeType = ChatScopeProject
		} else {
			scopeType = ChatScopeResource
			scopeID = resourceID
		}
	}
	if scopeType == ChatScopeResource && scopeID == "" {
		scopeID = resourceID
	}
	scope := ChatScope{Type: scopeType, ID: scopeID}
	if err := validateChatScopeIdentity(scope); err != nil {
		return ChatScope{}, err
	}
	return scope, nil
}

// ChatStore persists one continuing conversation for each Project, Resource,
// or Draft scope. Resource keys retain their legacy hash so existing transcripts
// remain readable; Draft keys include an explicit type discriminator.
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
	scope, err := ResolveChatScope("", "", resourceID)
	if err != nil {
		return ChatSession{}, err
	}
	return s.GetScope(projectID, scope)
}

func (s *ChatStore) GetScope(projectID string, scope ChatScope) (ChatSession, error) {
	if err := validateChatScope(projectID, scope); err != nil {
		return ChatSession{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.read(projectID, scope)
}

func (s *ChatStore) Append(projectID, resourceID string, messages ...Message) (ChatSession, error) {
	scope, err := ResolveChatScope("", "", resourceID)
	if err != nil {
		return ChatSession{}, err
	}
	return s.AppendScope(projectID, scope, messages...)
}

func (s *ChatStore) AppendScope(projectID string, scope ChatScope, messages ...Message) (ChatSession, error) {
	if err := validateChatScope(projectID, scope); err != nil {
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
	session, err := s.read(projectID, scope)
	if errors.Is(err, ErrChatSessionNotFound) {
		session = ChatSession{
			SchemaVersion: chatSessionSchemaVersion,
			ID:            chatScopeID(projectID, scope),
			ProjectID:     projectID,
			ResourceID:    legacyResourceID(scope),
			ScopeType:     scope.Type,
			ScopeID:       scope.ID,
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

func (s *ChatStore) read(projectID string, scope ChatScope) (ChatSession, error) {
	target := filepath.Join(s.dir, chatScopeID(projectID, scope)+".json")
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
	storedScope := ChatScope{Type: session.ScopeType, ID: session.ScopeID}
	if storedScope.Type == "" {
		storedScope, _ = ResolveChatScope("", "", session.ResourceID)
	}
	if session.SchemaVersion != chatSessionSchemaVersion || session.ID != chatScopeID(projectID, scope) ||
		session.ProjectID != projectID || storedScope != scope {
		return ChatSession{}, errors.New("stored chat session identity is invalid")
	}
	session.ScopeType = storedScope.Type
	session.ScopeID = storedScope.ID
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

func chatScopeID(projectID string, scope ChatScope) string {
	storageID := scope.ID
	if scope.Type == ChatScopeDraft {
		storageID = ChatScopeDraft + "\x00" + scope.ID
	}
	digest := sha256.Sum256([]byte(projectID + "\x00" + storageID))
	return "chat-" + hex.EncodeToString(digest[:16])
}

func validateChatScope(projectID string, scope ChatScope) error {
	if strings.TrimSpace(projectID) == "" || len(projectID) > 200 || !utf8.ValidString(projectID) {
		return errors.New("project_id is invalid")
	}
	return validateChatScopeIdentity(scope)
}

func validateChatScopeIdentity(scope ChatScope) error {
	if scope.Type != ChatScopeProject && scope.Type != ChatScopeResource && scope.Type != ChatScopeDraft {
		return errors.New("scope_type is invalid")
	}
	if len(scope.ID) > 200 || !utf8.ValidString(scope.ID) {
		return errors.New("scope_id is invalid")
	}
	if scope.Type == ChatScopeProject && scope.ID != "" {
		return errors.New("project scope_id must be empty")
	}
	if scope.Type != ChatScopeProject && strings.TrimSpace(scope.ID) == "" {
		return errors.New("scope_id is required")
	}
	return nil
}

func legacyResourceID(scope ChatScope) string {
	if scope.Type == ChatScopeResource {
		return scope.ID
	}
	return ""
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
