package projectmirror

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	SchemaVersion                       = 3
	ArtifactPolicyMetadataOnly          = "metadata-only"
	ArtifactPolicyMetadataVisualization = "metadata+geometry-visualization"
	maxGeometryVisualizationFileSize    = 25 * 1024 * 1024

	StatusSyncing   = "syncing"
	StatusCompleted = "completed"
	StatusPartial   = "partial"
	StatusFailed    = "failed"

	SyncStatusMetadata = "metadata"
	SyncStatusPreview  = "preview"
	SyncStatusFull     = "full"
)

type ResourceStatus struct {
	ID        string                    `json:"id"`
	Type      string                    `json:"type"`
	Status    string                    `json:"status"`
	Error     string                    `json:"error,omitempty"`
	Artifacts map[string]ArtifactStatus `json:"artifacts,omitempty"`
	SyncedAt  time.Time                 `json:"synced_at,omitempty"`
}

type ArtifactStatus struct {
	Path       string    `json:"path"`
	LocalPath  string    `json:"local_path"`
	SizeBytes  int64     `json:"size_bytes"`
	Checksum   string    `json:"checksum,omitempty"`
	LOD        int       `json:"lod,omitempty"`
	Status     string    `json:"status"`
	SyncStatus string    `json:"sync_status,omitempty"`
	SyncedAt   time.Time `json:"synced_at"`
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
		ArtifactPolicy: ArtifactPolicyMetadataOnly,
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

func (s *Store) PutResourceVisualization(
	projectID string,
	resourceType string,
	resourceID string,
	manifest json.RawMessage,
	bins map[string][]byte,
	lod int,
) (map[string]ArtifactStatus, error) {
	if err := validateID(projectID); err != nil {
		return nil, err
	}
	if !validResourceType(resourceType) {
		return nil, errors.New("unsupported resource type for visualization")
	}
	if err := validateID(resourceID); err != nil {
		return nil, err
	}
	if !json.Valid(manifest) {
		return nil, errors.New("resource visualization manifest must be valid JSON")
	}
	resourceDir := filepath.Join(s.projectDir(projectID), "resources", resourceType, resourceID)
	if err := os.MkdirAll(resourceDir, 0o700); err != nil {
		return nil, err
	}
	staging, err := os.MkdirTemp(resourceDir, ".visualize-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(staging)
	manifestDir := filepath.Join(staging, "manifest")
	if err := s.writeRawJSON(filepath.Join(manifestDir, "manifest.json"), manifest); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	artifacts := map[string]ArtifactStatus{}
	addArtifact := func(remotePath, localPath string, size int64, checksum string, syncStatus string) {
		artifacts[remotePath] = ArtifactStatus{
			Path:       remotePath,
			LocalPath:  localPath,
			SizeBytes:  size,
			Checksum:   checksum,
			LOD:        lod,
			Status:     "completed",
			SyncStatus: syncStatus,
			SyncedAt:   now,
		}
	}
	manifestRelative := filepath.ToSlash(filepath.Join(
		"resources", resourceType, resourceID, "visualize", "manifest", "manifest.json",
	))
	manifestInfo, err := os.Stat(filepath.Join(manifestDir, "manifest.json"))
	if err != nil {
		return nil, err
	}
	manifestChecksum := sha256File(filepath.Join(manifestDir, "manifest.json"))
	addArtifact(
		"visualize/manifest/manifest.json",
		manifestRelative,
		manifestInfo.Size(),
		manifestChecksum,
		SyncStatusMetadata,
	)
	for relative, payload := range bins {
		clean, err := validateVisualizationPath(relative, ".bin")
		if err != nil {
			return nil, err
		}
		if err := s.writeBytes(filepath.Join(manifestDir, filepath.FromSlash(clean)), payload); err != nil {
			return nil, err
		}
		localRelative := filepath.ToSlash(filepath.Join(
			"resources", resourceType, resourceID, "visualize", "manifest", filepath.FromSlash(clean),
		))
		checksum := sha256Sum(payload)
		addArtifact("visualize/manifest/"+clean, localRelative, int64(len(payload)), checksum, SyncStatusPreview)
	}

	target := filepath.Join(resourceDir, "visualize")
	backup := filepath.Join(resourceDir, ".visualize-previous")
	_ = os.RemoveAll(backup)
	if _, err := os.Stat(target); err == nil {
		if err := os.Rename(target, backup); err != nil {
			return nil, err
		}
	}
	if err := os.Rename(staging, target); err != nil {
		_ = os.Rename(backup, target)
		return nil, err
	}
	_ = os.RemoveAll(backup)
	return artifacts, nil
}

// PutGeometryVisualization is retained for backward compatibility.
func (s *Store) PutGeometryVisualization(
	projectID string,
	resourceID string,
	manifest json.RawMessage,
	bins map[string][]byte,
) (map[string]ArtifactStatus, error) {
	return s.PutResourceVisualization(projectID, "Geometry", resourceID, manifest, bins, 0)
}

func (s *Store) ResourceVisualizationManifest(resourceType, resourceID string) (json.RawMessage, error) {
	if !validResourceType(resourceType) {
		return nil, errors.New("unsupported resource type for visualization")
	}
	target, err := s.findResourceVisualizationFile(resourceType, resourceID, "manifest.json")
	if err != nil {
		return nil, err
	}
	payload, err := os.ReadFile(target)
	if err != nil {
		return nil, err
	}
	if !json.Valid(payload) {
		return nil, errors.New("cached resource visualization manifest is invalid")
	}
	return payload, nil
}

// ResourceProjectID locates the mirrored Project that owns a resource. Flow360
// resource IDs are globally unique, so preview routes do not need to carry the
// Project ID merely to persist an on-demand visualization.
func (s *Store) ResourceProjectID(resourceType, resourceID string) (string, error) {
	if !validResourceType(resourceType) {
		return "", errors.New("unsupported resource type")
	}
	if err := validateID(resourceID); err != nil {
		return "", err
	}
	projects, err := os.ReadDir(s.root)
	if err != nil {
		return "", err
	}
	for _, project := range projects {
		if !project.IsDir() || validateID(project.Name()) != nil {
			continue
		}
		detail := filepath.Join(s.root, project.Name(), "resources", resourceType, resourceID, "detail.json")
		if info, statErr := os.Stat(detail); statErr == nil && info.Mode().IsRegular() {
			return project.Name(), nil
		}
		var inventory struct {
			Items []struct {
				ID   string `json:"id"`
				Type string `json:"type"`
			} `json:"items"`
		}
		payload, readErr := os.ReadFile(filepath.Join(s.root, project.Name(), "items.json"))
		if readErr == nil && json.Unmarshal(payload, &inventory) == nil {
			for _, item := range inventory.Items {
				if item.ID == resourceID && item.Type == resourceType {
					return project.Name(), nil
				}
			}
		}
	}
	return "", os.ErrNotExist
}

// GeometryVisualizationManifest is retained for backward compatibility.
func (s *Store) GeometryVisualizationManifest(resourceID string) (json.RawMessage, error) {
	return s.ResourceVisualizationManifest("Geometry", resourceID)
}

func (s *Store) ResourceVisualizationFile(resourceType, resourceID, relative string) ([]byte, error) {
	if !validResourceType(resourceType) {
		return nil, errors.New("unsupported resource type for visualization")
	}
	clean, err := validateVisualizationPath(relative, "")
	if err != nil {
		return nil, err
	}
	target, err := s.findResourceVisualizationFile(resourceType, resourceID, clean)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(target)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("resource visualization asset must be a regular file")
	}
	if info.Size() > maxGeometryVisualizationFileSize {
		return nil, errors.New("resource visualization asset exceeds the size limit")
	}
	return os.ReadFile(target)
}

// GeometryVisualizationFile is retained for backward compatibility.
func (s *Store) GeometryVisualizationFile(resourceID, relative string) ([]byte, error) {
	return s.ResourceVisualizationFile("Geometry", resourceID, relative)
}

func (s *Store) findResourceVisualizationFile(resourceType, resourceID, relative string) (string, error) {
	if err := validateID(resourceID); err != nil {
		return "", err
	}
	projects, err := os.ReadDir(s.root)
	if err != nil {
		return "", err
	}
	for _, project := range projects {
		if !project.IsDir() || validateID(project.Name()) != nil {
			continue
		}
		target := filepath.Join(
			s.root,
			project.Name(),
			"resources",
			resourceType,
			resourceID,
			"visualize",
			"manifest",
			filepath.FromSlash(relative),
		)
		if _, err := os.Stat(target); err == nil {
			return target, nil
		}
	}
	return "", os.ErrNotExist
}

// findGeometryVisualizationFile is retained for backward compatibility.
func (s *Store) findGeometryVisualizationFile(resourceID, relative string) (string, error) {
	return s.findResourceVisualizationFile("Geometry", resourceID, relative)
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

func (s *Store) writeBytes(target string, payload []byte) error {
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

func validateVisualizationPath(value, extension string) (string, error) {
	if strings.Contains(value, "\\") {
		return "", errors.New("visualization path must use forward slashes")
	}
	value = strings.TrimSpace(value)
	clean := filepath.ToSlash(filepath.Clean(value))
	if value == "" || clean != value || strings.HasPrefix(clean, "/") || strings.Contains(clean, "..") {
		return "", errors.New("unsafe visualization path")
	}
	if extension != "" && !strings.HasSuffix(strings.ToLower(clean), extension) {
		return "", fmt.Errorf("visualization path must use %s", extension)
	}
	if extension == "" &&
		clean != "manifest.json" &&
		!strings.HasSuffix(strings.ToLower(clean), ".bin") {
		return "", errors.New("unsupported visualization asset")
	}
	return clean, nil
}

func readJSON(path string, target any) error {
	payload, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(payload, target)
}

func sha256File(path string) string {
	payload, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return sha256Sum(payload)
}

func sha256Sum(payload []byte) string {
	hash := sha256.Sum256(payload)
	return hex.EncodeToString(hash[:])
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
