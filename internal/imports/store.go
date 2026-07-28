package imports

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Plan struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	SourceType    string          `json:"source_type"`
	Unit          string          `json:"unit"`
	Workflow      string          `json:"workflow"`
	SolverVersion string          `json:"solver_version,omitempty"`
	FolderID      string          `json:"folder_id,omitempty"`
	Tags          []string        `json:"tags,omitempty"`
	Files         []string        `json:"files"`
	SizeBytes     int64           `json:"size_bytes"`
	Status        string          `json:"status"`
	Command       []string        `json:"command_preview"`
	Result        json.RawMessage `json:"result,omitempty"`
	Error         string          `json:"error,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

type Store struct {
	dir string
	mu  sync.Mutex
}

func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

func (s *Store) Create(plan Plan) (Plan, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return Plan{}, "", err
	}
	plan.ID = "import-" + hex.EncodeToString(buf)
	plan.Status = "draft"
	plan.CreatedAt = time.Now().UTC()
	plan.UpdatedAt = plan.CreatedAt
	dir := filepath.Join(s.dir, plan.ID)
	if err := os.MkdirAll(filepath.Join(dir, "files"), 0o700); err != nil {
		return Plan{}, "", err
	}
	return plan, dir, s.write(plan)
}

func (s *Store) Get(id string) (Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(id)
}

func (s *Store) Update(id string, fn func(*Plan) error) (Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, err := s.read(id)
	if err != nil {
		return Plan{}, err
	}
	if err := fn(&plan); err != nil {
		return Plan{}, err
	}
	plan.UpdatedAt = time.Now().UTC()
	return plan, s.write(plan)
}

func (s *Store) FilePaths(plan Plan) []string {
	result := make([]string, 0, len(plan.Files))
	for _, name := range plan.Files {
		result = append(result, filepath.Join(s.dir, plan.ID, "files", name))
	}
	return result
}

func (s *Store) read(id string) (Plan, error) {
	if !strings.HasPrefix(id, "import-") || strings.ContainsAny(id, `/\`) {
		return Plan{}, errors.New("invalid import id")
	}
	data, err := os.ReadFile(filepath.Join(s.dir, id, "plan.json"))
	if os.IsNotExist(err) {
		return Plan{}, errors.New("import plan not found")
	}
	var plan Plan
	if err == nil {
		err = json.Unmarshal(data, &plan)
	}
	return plan, err
}

func (s *Store) write(plan Plan) error {
	data, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(s.dir, plan.ID, "plan.json")
	tmp, err := os.CreateTemp(filepath.Dir(path), ".import-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func (s *Store) Abort(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !strings.HasPrefix(id, "import-") || strings.ContainsAny(id, `/\`) {
		return errors.New("invalid import id")
	}
	return os.RemoveAll(filepath.Join(s.dir, id))
}

func (s *Store) FilesDir(planID string) string {
	return filepath.Join(s.dir, planID, "files")
}
