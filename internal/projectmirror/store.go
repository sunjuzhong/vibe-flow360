package projectmirror

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	SchemaVersion          = 1
	ArtifactPolicyMetadata = "metadata-only"

	StatusSyncing   = "syncing"
	StatusCompleted = "completed"
	StatusPartial   = "partial"
	StatusFailed    = "failed"
)

type ResourceStatus struct {
	ID       string    `json:"id"`
	Type     string    `json:"type"`
	Status   string    `json:"status"`
	Error    string    `json:"error,omitempty"`
	SyncedAt time.Time `json:"synced_at,omitempty"`
}

type Manifest struct {
	SchemaVersion   int                       `json:"schema_version"`
	ProjectID       string                    `json:"project_id"`
	Namespace       string                    `json:"namespace"`
	LocalPath       string                    `json:"local_path"`
	ArtifactPolicy  string                    `json:"artifact_policy"`
	Status          string                    `json:"status"`
	TotalResources  int                       `json:"total_resources"`
	SyncedResources int                       `json:"synced_resources"`
	FailedResources int                       `json:"failed_resources"`
	CurrentResource string                    `json:"current_resource,omitempty"`
	Failures        map[string]string         `json:"failures"`
	Resources       map[string]ResourceStatus `json:"resources"`
	StartedAt       time.Time                 `json:"started_at"`
	UpdatedAt       time.Time                 `json:"updated_at"`
	CompletedAt     *time.Time                `json:"completed_at,omitempty"`
}

func NewManifest(projectID, namespace string) Manifest {
	now := time.Now().UTC()
	return Manifest{
		SchemaVersion:  SchemaVersion,
		ProjectID:      projectID,
		Namespace:      namespace,
		ArtifactPolicy: ArtifactPolicyMetadata,
		Status:         StatusSyncing,
		Failures:       map[string]string{},
		Resources:      map[string]ResourceStatus{},
		StartedAt:      now,
		UpdatedAt:      now,
	}
}

type Store struct {
	root      string
	namespace string
}

func New(root, namespace string) (*Store, error) {
	namespace = strings.TrimSpace(namespace)
	if err := validateID(namespace); err != nil {
		return nil, fmt.Errorf("invalid mirror namespace: %w", err)
	}
	root = filepath.Join(root, namespace)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create project mirror root: %w", err)
	}
	return &Store{root: root, namespace: namespace}, nil
}

func (s *Store) Namespace() string {
	return s.namespace
}

func (s *Store) PutManifest(manifest Manifest) error {
	if err := validateID(manifest.ProjectID); err != nil {
		return err
	}
	manifest.Namespace = s.namespace
	manifest.LocalPath = s.projectDir(manifest.ProjectID)
	manifest.UpdatedAt = time.Now().UTC()
	return s.writeJSON(filepath.Join(s.projectDir(manifest.ProjectID), "manifest.json"), manifest)
}

func (s *Store) GetManifest(projectID string) (Manifest, error) {
	if err := validateID(projectID); err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	if err := readJSON(filepath.Join(s.projectDir(projectID), "manifest.json"), &manifest); err != nil {
		return Manifest{}, err
	}
	if manifest.ProjectID != projectID || manifest.Namespace != s.namespace {
		return Manifest{}, errors.New("project mirror manifest identity mismatch")
	}
	manifest.LocalPath = s.projectDir(projectID)
	return manifest, nil
}

func (s *Store) PutProjectData(projectID, kind string, value json.RawMessage) error {
	if err := validateID(projectID); err != nil {
		return err
	}
	filename := map[string]string{
		"project-info":  "project.json",
		"project-tree":  "tree.json",
		"project-items": "items.json",
	}[kind]
	if filename == "" {
		return errors.New("unsupported project mirror kind")
	}
	return s.writeRawJSON(filepath.Join(s.projectDir(projectID), filename), value)
}

func (s *Store) PutResource(projectID, resourceType, resourceID string, value json.RawMessage) error {
	if err := validateID(projectID); err != nil {
		return err
	}
	if !validResourceType(resourceType) {
		return errors.New("unsupported resource type")
	}
	if err := validateID(resourceID); err != nil {
		return err
	}
	target := filepath.Join(
		s.projectDir(projectID),
		"resources",
		resourceType,
		resourceID,
		"detail.json",
	)
	return s.writeRawJSON(target, value)
}

func (s *Store) ProjectDir(projectID string) (string, error) {
	if err := validateID(projectID); err != nil {
		return "", err
	}
	return s.projectDir(projectID), nil
}

func (s *Store) projectDir(projectID string) string {
	return filepath.Join(s.root, projectID)
}

func (s *Store) writeRawJSON(target string, value json.RawMessage) error {
	if !json.Valid(value) {
		return errors.New("project mirror data must be valid JSON")
	}
	var decoded any
	if err := json.Unmarshal(value, &decoded); err != nil {
		return err
	}
	return s.writeJSON(target, decoded)
}

func (s *Store) writeJSON(target string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, ".mirror-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, target)
}

func readJSON(path string, target any) error {
	payload, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(payload, target)
}

func validateID(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("identifier is required")
	}
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z':
		case char >= 'A' && char <= 'Z':
		case char >= '0' && char <= '9':
		case char == '-', char == '_', char == '.':
		default:
			return errors.New("identifier contains unsupported characters")
		}
	}
	if value == "." || value == ".." || strings.Contains(value, "..") {
		return errors.New("identifier cannot traverse directories")
	}
	return nil
}

func validResourceType(value string) bool {
	switch value {
	case "Geometry", "SurfaceMesh", "VolumeMesh", "Case":
		return true
	default:
		return false
	}
}
