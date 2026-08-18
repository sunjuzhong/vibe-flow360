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
	"project-info":            {},
	"project-tree":            {},
	"project-items":           {},
	"draft-list":              {},
	"resource-detail":         {},
	"resource-detail-partial": {},
	"visualization-error":     {},
	"folder-tree":             {},
	"project-list":            {},
	"folder-projects":         {},
}

const (
	DefaultTTL       = 15 * time.Minute
	DefaultRetention = 30 * 24 * time.Hour
)

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

func (s *Store) GetFresh(kind, key string, ttl time.Duration) (Entry, error) {
	entry, err := s.Get(kind, key)
	if err != nil {
		return Entry{}, err
	}
	if ttl > 0 && time.Since(entry.CachedAt) > ttl {
		return Entry{}, errors.New("cache entry is expired")
	}
	return entry, nil
}

// Delete removes one cached snapshot. A missing entry is already consistent
// with the requested state and is therefore not an error.
func (s *Store) Delete(kind, key string) error {
	if _, ok := allowedKinds[kind]; !ok {
		return errors.New("unsupported cache kind")
	}
	if key == "" {
		return errors.New("cache key is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.Remove(filepath.Join(s.dir, kind, cacheFileName(key)))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// DeleteKind removes every snapshot of a kind. It is used when a mutation
// does not carry the parent key needed to invalidate a single listing.
func (s *Store) DeleteKind(kind string) error {
	if _, ok := allowedKinds[kind]; !ok {
		return errors.New("unsupported cache kind")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.RemoveAll(filepath.Join(s.dir, kind))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *Store) Cleanup(ttl time.Duration) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	removed := 0
	for kind := range allowedKinds {
		dir := filepath.Join(s.dir, kind)
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return removed, err
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			payload, err := os.ReadFile(filepath.Join(dir, entry.Name()))
			if err != nil {
				continue
			}
			var e Entry
			if err := json.Unmarshal(payload, &e); err != nil {
				os.Remove(filepath.Join(dir, entry.Name()))
				removed++
				continue
			}
			if ttl > 0 && time.Since(e.CachedAt) > ttl {
				os.Remove(filepath.Join(dir, entry.Name()))
				removed++
			}
		}
	}
	return removed, nil
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
