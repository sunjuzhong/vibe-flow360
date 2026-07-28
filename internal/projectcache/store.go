package projectcache

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var allowedKinds = map[string]struct{}{
	"project-info":    {},
	"project-tree":    {},
	"project-items":   {},
	"resource-detail": {},
}

type Entry struct {
	Key      string          `json:"key"`
	Data     json.RawMessage `json:"data"`
	CachedAt time.Time       `json:"cached_at"`
}

type Store struct {
	dir string
	mu  sync.RWMutex
}

func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

func (s *Store) Put(kind, key string, data json.RawMessage) (Entry, error) {
	if err := validate(kind, key, data); err != nil {
		return Entry{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	entry := Entry{
		Key:      key,
		Data:     append(json.RawMessage(nil), data...),
		CachedAt: time.Now().UTC(),
	}
	payload, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return Entry{}, err
	}
	dir := filepath.Join(s.dir, kind)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Entry{}, err
	}
	target := filepath.Join(dir, cacheFileName(key))
	temp, err := os.CreateTemp(dir, ".snapshot-*.tmp")
	if err != nil {
		return Entry{}, err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return Entry{}, err
	}
	if _, err := temp.Write(payload); err != nil {
		temp.Close()
		return Entry{}, err
	}
	if err := temp.Close(); err != nil {
		return Entry{}, err
	}
	if err := os.Rename(tempName, target); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (s *Store) Get(kind, key string) (Entry, error) {
	if _, ok := allowedKinds[kind]; !ok {
		return Entry{}, errors.New("unsupported cache kind")
	}
	if key == "" {
		return Entry{}, errors.New("cache key is required")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	payload, err := os.ReadFile(filepath.Join(s.dir, kind, cacheFileName(key)))
	if os.IsNotExist(err) {
		return Entry{}, errors.New("cache entry not found")
	}
	if err != nil {
		return Entry{}, err
	}
	var entry Entry
	if err := json.Unmarshal(payload, &entry); err != nil {
		return Entry{}, err
	}
	if entry.Key != key || !json.Valid(entry.Data) {
		return Entry{}, errors.New("cache entry is invalid")
	}
	return entry, nil
}

func validate(kind, key string, data json.RawMessage) error {
	if _, ok := allowedKinds[kind]; !ok {
		return errors.New("unsupported cache kind")
	}
	if key == "" {
		return errors.New("cache key is required")
	}
	if !json.Valid(data) {
		return errors.New("cache data must be valid JSON")
	}
	return nil
}

func cacheFileName(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:]) + ".json"
}
