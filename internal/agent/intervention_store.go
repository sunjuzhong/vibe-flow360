package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// InterventionStore provides persistence for interventions
type InterventionStore struct {
	dir string
	mu  sync.Mutex
}

// NewInterventionStore creates a new intervention store
func NewInterventionStore(dir string) (*InterventionStore, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		dir = ".vibesim/interventions"
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create intervention store: %w", err)
	}
	return &InterventionStore{dir: dir}, nil
}

// Create persists a new intervention
func (s *InterventionStore) Create(intervention Intervention) (Intervention, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.write(intervention); err != nil {
		return Intervention{}, err
	}
	return intervention, nil
}

// Get retrieves an intervention by ID
func (s *InterventionStore) Get(id string) (Intervention, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(id)
}

// Update updates an existing intervention
func (s *InterventionStore) Update(id string, mutate func(*Intervention) error) (Intervention, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	intervention, err := s.read(id)
	if err != nil {
		return Intervention{}, err
	}
	if err := mutate(&intervention); err != nil {
		return Intervention{}, err
	}
	intervention.UpdatedAt = time.Now().UTC()
	if err := s.write(intervention); err != nil {
		return Intervention{}, err
	}
	return intervention, nil
}

// List retrieves interventions with optional filters
func (s *InterventionStore) List(projectID, resourceID, state string) ([]Intervention, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var result []Intervention
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		intervention, readErr := s.read(strings.TrimSuffix(entry.Name(), ".json"))
		if readErr != nil {
			continue
		}
		if projectID != "" && intervention.ProjectID != projectID {
			continue
		}
		if resourceID != "" && intervention.ResourceID != resourceID {
			continue
		}
		if state != "" && intervention.State != state {
			continue
		}
		result = append(result, intervention)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result, nil
}

// ListActive returns all active (non-terminal) interventions
func (s *InterventionStore) ListActive() ([]Intervention, error) {
	return s.List("", "", "")
}

// CleanupClosed removes interventions closed before the given time
func (s *InterventionStore) CleanupClosed(olderThan time.Duration) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().UTC().Add(-olderThan)
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		intervention, readErr := s.read(strings.TrimSuffix(entry.Name(), ".json"))
		if readErr != nil {
			continue
		}
		if intervention.State == InterventionClosed && intervention.UpdatedAt.Before(cutoff) {
			path := filepath.Join(s.dir, entry.Name())
			if err := os.Remove(path); err == nil {
				removed++
			}
		}
	}
	return removed, nil
}

// GenerateID generates a unique intervention ID
func (s *InterventionStore) GenerateID() (string, error) {
	return newInterventionID()
}

func (s *InterventionStore) read(id string) (Intervention, error) {
	if !validInterventionID(id) {
		return Intervention{}, errors.New("invalid intervention ID")
	}
	data, err := os.ReadFile(filepath.Join(s.dir, id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return Intervention{}, ErrInterventionNotFound
	}
	if err != nil {
		return Intervention{}, err
	}
	var intervention Intervention
	if err := json.Unmarshal(data, &intervention); err != nil {
		return Intervention{}, err
	}
	return intervention, nil
}

func (s *InterventionStore) write(intervention Intervention) error {
	data, err := json.MarshalIndent(intervention, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(s.dir, intervention.ID+".json")
	temp, err := os.CreateTemp(s.dir, ".intervention-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, path)
}

func validInterventionID(id string) bool {
	return strings.HasPrefix(id, "intv-") && len(id) == 21
}
