package compareworkspace

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sunjuzhong/vibe-flow360/internal/comparison"
)

const SchemaVersion = 1

var ErrNotFound = errors.New("compare workspace not found")

type Participant struct {
	ProjectID           string `json:"project_id"`
	ProjectNameSnapshot string `json:"project_name_snapshot,omitempty"`
	CaseID              string `json:"case_id"`
	CaseNameSnapshot    string `json:"case_name_snapshot"`
	Role                string `json:"role"`
	Position            int    `json:"position"`
	Availability        string `json:"availability"`
}

type EvidenceRevision struct {
	ID        string                   `json:"id"`
	Number    int                      `json:"number"`
	Snapshot  comparison.CompareResult `json:"snapshot"`
	CreatedAt time.Time                `json:"created_at"`
}

type AISession struct {
	ID                 string    `json:"id"`
	EvidenceRevisionID string    `json:"evidence_revision_id"`
	Question           string    `json:"question,omitempty"`
	Analysis           string    `json:"analysis"`
	Provider           string    `json:"provider,omitempty"`
	Model              string    `json:"model,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
}

type Workspace struct {
	SchemaVersion    int                `json:"schema_version"`
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	Status           string             `json:"status"`
	Participants     []Participant      `json:"participants"`
	ActiveRevisionID string             `json:"active_revision_id"`
	Revisions        []EvidenceRevision `json:"revisions"`
	ViewState        json.RawMessage    `json:"view_state,omitempty"`
	AISessions       []AISession        `json:"ai_sessions,omitempty"`
	CreatedAt        time.Time          `json:"created_at"`
	UpdatedAt        time.Time          `json:"updated_at"`
}

type CreateInput struct {
	Name         string
	Participants []Participant
	Snapshot     comparison.CompareResult
	ViewState    json.RawMessage
}

type Store struct {
	dir string
	mu  sync.RWMutex
}

func NewStore(dir string) (*Store, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, errors.New("compare workspace directory is required")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create compare workspace store: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, fmt.Errorf("secure compare workspace store: %w", err)
	}
	return &Store{dir: dir}, nil
}

func (s *Store) Create(input CreateInput) (Workspace, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len(name) > 120 {
		return Workspace{}, errors.New("compare workspace name must be between 1 and 120 characters")
	}
	if len(input.Participants) < 2 {
		return Workspace{}, errors.New("at least two participants are required")
	}
	for index := range input.Participants {
		participant := &input.Participants[index]
		participant.ProjectID = strings.TrimSpace(participant.ProjectID)
		participant.CaseID = strings.TrimSpace(participant.CaseID)
		participant.CaseNameSnapshot = strings.TrimSpace(participant.CaseNameSnapshot)
		participant.Position = index
		participant.Role = "candidate"
		if index == 0 {
			participant.Role = "baseline"
		}
		participant.Availability = "available"
		if participant.CaseID == "" {
			return Workspace{}, errors.New("participant Case ID is required")
		}
	}
	if len(input.ViewState) > 512<<10 {
		return Workspace{}, errors.New("compare view state exceeds 512 KB")
	}
	id, err := newID("cmp")
	if err != nil {
		return Workspace{}, err
	}
	revisionID, err := newID("rev")
	if err != nil {
		return Workspace{}, err
	}
	now := time.Now().UTC()
	workspace := Workspace{
		SchemaVersion:    SchemaVersion,
		ID:               id,
		Name:             name,
		Status:           "active",
		Participants:     append([]Participant(nil), input.Participants...),
		ActiveRevisionID: revisionID,
		Revisions: []EvidenceRevision{{
			ID: revisionID, Number: 1, Snapshot: input.Snapshot, CreatedAt: now,
		}},
		ViewState: append(json.RawMessage(nil), input.ViewState...),
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.write(workspace); err != nil {
		return Workspace{}, err
	}
	return workspace, nil
}

func (s *Store) Get(id string) (Workspace, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.read(id)
}

func (s *Store) List() ([]Workspace, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	result := make([]Workspace, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		workspace, readErr := s.read(strings.TrimSuffix(entry.Name(), ".json"))
		if readErr == nil {
			result = append(result, workspace)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].UpdatedAt.After(result[j].UpdatedAt) })
	return result, nil
}

func (s *Store) UpdateViewState(id string, viewState json.RawMessage) (Workspace, error) {
	if len(viewState) > 512<<10 {
		return Workspace{}, errors.New("compare view state exceeds 512 KB")
	}
	var decoded any
	if len(viewState) > 0 && json.Unmarshal(viewState, &decoded) != nil {
		return Workspace{}, errors.New("compare view state must be valid JSON")
	}
	return s.update(id, func(workspace *Workspace) error {
		workspace.ViewState = append(json.RawMessage(nil), viewState...)
		return nil
	})
}

func (s *Store) AddRevision(id string, snapshot comparison.CompareResult) (Workspace, error) {
	return s.update(id, func(workspace *Workspace) error {
		revisionID, err := newID("rev")
		if err != nil {
			return err
		}
		revision := EvidenceRevision{
			ID: revisionID, Number: len(workspace.Revisions) + 1, Snapshot: snapshot, CreatedAt: time.Now().UTC(),
		}
		workspace.Revisions = append(workspace.Revisions, revision)
		workspace.ActiveRevisionID = revisionID
		return nil
	})
}

func (s *Store) AppendAISession(id string, session AISession) (Workspace, error) {
	if strings.TrimSpace(session.Analysis) == "" {
		return Workspace{}, errors.New("AI analysis is required")
	}
	return s.update(id, func(workspace *Workspace) error {
		if session.EvidenceRevisionID == "" {
			session.EvidenceRevisionID = workspace.ActiveRevisionID
		}
		revisionExists := false
		for _, revision := range workspace.Revisions {
			if revision.ID == session.EvidenceRevisionID {
				revisionExists = true
				break
			}
		}
		if !revisionExists {
			return errors.New("AI session evidence revision does not exist")
		}
		var err error
		session.ID, err = newID("ai")
		if err != nil {
			return err
		}
		session.CreatedAt = time.Now().UTC()
		workspace.AISessions = append(workspace.AISessions, session)
		if len(workspace.AISessions) > 50 {
			workspace.AISessions = append([]AISession(nil), workspace.AISessions[len(workspace.AISessions)-50:]...)
		}
		return nil
	})
}

func (s *Store) SetStatus(id string, status string) (Workspace, error) {
	status = strings.TrimSpace(status)
	if status != "active" && status != "archived" {
		return Workspace{}, errors.New("compare workspace status must be active or archived")
	}
	return s.update(id, func(workspace *Workspace) error {
		workspace.Status = status
		return nil
	})
}

func (s *Store) Duplicate(id string, name string) (Workspace, error) {
	s.mu.RLock()
	source, err := s.read(id)
	s.mu.RUnlock()
	if err != nil {
		return Workspace{}, err
	}
	var active *EvidenceRevision
	for index := range source.Revisions {
		if source.Revisions[index].ID == source.ActiveRevisionID {
			active = &source.Revisions[index]
			break
		}
	}
	if active == nil {
		return Workspace{}, errors.New("active evidence revision is unavailable")
	}
	if strings.TrimSpace(name) == "" {
		name = source.Name + " copy"
	}
	return s.Create(CreateInput{
		Name: name, Participants: source.Participants, Snapshot: active.Snapshot, ViewState: source.ViewState,
	})
}

func (s *Store) Delete(id string) error {
	if !validID(id) {
		return errors.New("invalid compare workspace ID")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path := filepath.Join(s.dir, id+".json")
	if err := os.Remove(path); errors.Is(err, os.ErrNotExist) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	return nil
}

func (s *Store) update(id string, mutate func(*Workspace) error) (Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	workspace, err := s.read(id)
	if err != nil {
		return Workspace{}, err
	}
	if err := mutate(&workspace); err != nil {
		return Workspace{}, err
	}
	workspace.UpdatedAt = time.Now().UTC()
	if err := s.write(workspace); err != nil {
		return Workspace{}, err
	}
	return workspace, nil
}

func (s *Store) read(id string) (Workspace, error) {
	if !validID(id) {
		return Workspace{}, errors.New("invalid compare workspace ID")
	}
	payload, err := os.ReadFile(filepath.Join(s.dir, id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return Workspace{}, ErrNotFound
	}
	if err != nil {
		return Workspace{}, err
	}
	var workspace Workspace
	if err := json.Unmarshal(payload, &workspace); err != nil {
		return Workspace{}, err
	}
	if workspace.SchemaVersion != SchemaVersion || workspace.ID != id {
		return Workspace{}, errors.New("stored compare workspace identity is invalid")
	}
	return workspace, nil
}

func (s *Store) write(workspace Workspace) error {
	payload, err := json.MarshalIndent(workspace, "", "  ")
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(s.dir, ".compare-*.tmp")
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
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, filepath.Join(s.dir, workspace.ID+".json"))
}

func newID(prefix string) (string, error) {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return prefix + "-" + hex.EncodeToString(bytes), nil
}

func validID(id string) bool {
	if !strings.HasPrefix(id, "cmp-") || len(id) != len("cmp-")+24 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(id, "cmp-"))
	return err == nil
}
