package stepassets

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sunjuzhong/vibe-flow360/internal/aicreate"
)

type ValidationStatus string

const (
	StatusValidating ValidationStatus = "validating"
	StatusReady      ValidationStatus = "ready"
	StatusBlocked    ValidationStatus = "blocked"
)

type Validation struct {
	Status ValidationStatus             `json:"status"`
	Report *aicreate.GeometryValidation `json:"report,omitempty"`
	Error  string                       `json:"error,omitempty"`
}

type Version struct {
	ID              string             `json:"id"`
	AssetID         string             `json:"asset_id"`
	Number          int                `json:"number"`
	FileName        string             `json:"file_name"`
	Unit            string             `json:"unit"`
	Size            int64              `json:"size"`
	SHA256          string             `json:"sha256"`
	Source          string             `json:"source"`
	Prompt          string             `json:"prompt,omitempty"`
	ParentVersionID string             `json:"parent_version_id,omitempty"`
	Validation      Validation         `json:"validation"`
	Geometry        *aicreate.Geometry `json:"geometry,omitempty"`
	CreatedAt       time.Time          `json:"created_at"`
}

type Asset struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Versions    []Version `json:"versions"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type AIJobRequest struct {
	Prompt          string `json:"prompt"`
	Name            string `json:"name,omitempty"`
	AssetID         string `json:"asset_id,omitempty"`
	ParentVersionID string `json:"parent_version_id,omitempty"`
}

type AIJob struct {
	ID        string                        `json:"id"`
	Status    string                        `json:"status"`
	Stage     string                        `json:"stage"`
	Progress  int                           `json:"progress"`
	Detail    string                        `json:"detail,omitempty"`
	Request   AIJobRequest                  `json:"request"`
	AssetID   string                        `json:"asset_id,omitempty"`
	VersionID string                        `json:"version_id,omitempty"`
	Fields    []aicreate.ClarificationField `json:"fields,omitempty"`
	Error     string                        `json:"error,omitempty"`
	CreatedAt time.Time                     `json:"created_at"`
	UpdatedAt time.Time                     `json:"updated_at"`
}

type index struct {
	Assets map[string]Asset `json:"assets"`
	Jobs   map[string]AIJob `json:"jobs,omitempty"`
}

type Store struct {
	root      string
	indexPath string
	mu        sync.RWMutex
	assets    map[string]Asset
	jobs      map[string]AIJob
}

func NewStore(root string) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("STEP asset store root is required")
	}
	if err := os.MkdirAll(filepath.Join(root, "files"), 0o700); err != nil {
		return nil, err
	}
	store := &Store{root: root, indexPath: filepath.Join(root, "index.json"), assets: map[string]Asset{}, jobs: map[string]AIJob{}}
	payload, err := os.ReadFile(store.indexPath)
	if err != nil {
		if os.IsNotExist(err) {
			return store, nil
		}
		return nil, err
	}
	var persisted index
	if err := json.Unmarshal(payload, &persisted); err != nil {
		return nil, fmt.Errorf("read STEP asset index: %w", err)
	}
	if persisted.Assets != nil {
		store.assets = persisted.Assets
	}
	if persisted.Jobs != nil {
		store.jobs = persisted.Jobs
	}
	return store, nil
}

func (s *Store) CreateAIJob(request AIJobRequest) (AIJob, error) {
	request.Prompt = strings.TrimSpace(request.Prompt)
	if request.Prompt == "" {
		return AIJob{}, errors.New("AI STEP prompt is required")
	}
	id, err := newID("stepjob")
	if err != nil {
		return AIJob{}, err
	}
	now := time.Now().UTC()
	job := AIJob{ID: id, Status: "queued", Stage: "queued", Progress: 0, Detail: "Waiting for the geometry Agent.", Request: request, CreatedAt: now, UpdatedAt: now}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs[id] = job
	if err := s.persistLocked(); err != nil {
		return AIJob{}, err
	}
	return job, nil
}

func (s *Store) AIJob(id string) (AIJob, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.jobs[id]
	return job, ok
}

func (s *Store) AIJobs() []AIJob {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]AIJob, 0, len(s.jobs))
	for _, job := range s.jobs {
		result = append(result, job)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].UpdatedAt.After(result[j].UpdatedAt) })
	return result
}

func (s *Store) UpdateAIJob(id, status, stage string, progress int, detail string) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return AIJob{}, os.ErrNotExist
	}
	if status != "" {
		job.Status = status
	}
	if stage != "" {
		job.Stage = stage
	}
	if progress >= 0 {
		job.Progress = min(progress, 100)
	}
	job.Detail = strings.TrimSpace(detail)
	job.UpdatedAt = time.Now().UTC()
	s.jobs[id] = job
	if err := s.persistLocked(); err != nil {
		return AIJob{}, err
	}
	return job, nil
}

func (s *Store) FinishAIJob(id, status, assetID, versionID, detail, errorMessage string, fields []aicreate.ClarificationField) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return AIJob{}, os.ErrNotExist
	}
	job.Status, job.Stage = status, status
	if status == "completed" {
		job.Progress = 100
	}
	job.AssetID, job.VersionID = assetID, versionID
	job.Detail, job.Error, job.Fields = strings.TrimSpace(detail), strings.TrimSpace(errorMessage), fields
	job.UpdatedAt = time.Now().UTC()
	s.jobs[id] = job
	if err := s.persistLocked(); err != nil {
		return AIJob{}, err
	}
	return job, nil
}

func (s *Store) RecoverAIJobs() ([]AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := []AIJob{}
	for id, job := range s.jobs {
		if job.Status != "running" && job.Status != "recovering" && job.Status != "queued" {
			continue
		}
		job.Status, job.Stage = "recovering", "recovering"
		job.Detail = "The backend restarted; generation will resume from the durable request."
		job.UpdatedAt = time.Now().UTC()
		s.jobs[id] = job
		result = append(result, job)
	}
	if len(result) > 0 {
		if err := s.persistLocked(); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (s *Store) List() []Asset {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Asset, 0, len(s.assets))
	for _, asset := range s.assets {
		result = append(result, cloneAsset(asset))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].UpdatedAt.After(result[j].UpdatedAt) })
	return result
}

func (s *Store) Get(assetID string) (Asset, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	asset, ok := s.assets[assetID]
	return cloneAsset(asset), ok
}

func (s *Store) Version(assetID, versionID string) (Version, string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	asset, ok := s.assets[assetID]
	if !ok {
		return Version{}, "", false
	}
	for _, version := range asset.Versions {
		if version.ID == versionID {
			return version, s.versionPath(assetID, versionID), true
		}
	}
	return Version{}, "", false
}

func (s *Store) Create(name, description, fileName, unit, source, prompt, parentVersionID string, input io.Reader) (Asset, Version, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Asset{}, Version{}, errors.New("STEP asset name is required")
	}
	assetID, err := newID("step")
	if err != nil {
		return Asset{}, Version{}, err
	}
	now := time.Now().UTC()
	asset := Asset{ID: assetID, Name: name, Description: strings.TrimSpace(description), CreatedAt: now, UpdatedAt: now}
	version, err := s.writeVersion(assetID, 1, fileName, unit, source, prompt, parentVersionID, input)
	if err != nil {
		return Asset{}, Version{}, err
	}
	asset.Versions = []Version{version}
	s.mu.Lock()
	s.assets[asset.ID] = asset
	err = s.persistLocked()
	s.mu.Unlock()
	if err != nil {
		return Asset{}, Version{}, err
	}
	return cloneAsset(asset), version, nil
}

func (s *Store) AddVersion(assetID, fileName, unit, source, prompt, parentVersionID string, input io.Reader) (Asset, Version, error) {
	s.mu.RLock()
	asset, ok := s.assets[assetID]
	s.mu.RUnlock()
	if !ok {
		return Asset{}, Version{}, os.ErrNotExist
	}
	version, err := s.writeVersion(assetID, len(asset.Versions)+1, fileName, unit, source, prompt, parentVersionID, input)
	if err != nil {
		return Asset{}, Version{}, err
	}
	s.mu.Lock()
	asset = s.assets[assetID]
	version.Number = len(asset.Versions) + 1
	asset.Versions = append(asset.Versions, version)
	asset.UpdatedAt = version.CreatedAt
	s.assets[assetID] = asset
	err = s.persistLocked()
	s.mu.Unlock()
	if err != nil {
		return Asset{}, Version{}, err
	}
	return cloneAsset(asset), version, nil
}

func (s *Store) SetValidation(assetID, versionID string, validation Validation) (Version, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	asset, ok := s.assets[assetID]
	if !ok {
		return Version{}, os.ErrNotExist
	}
	for index := range asset.Versions {
		if asset.Versions[index].ID != versionID {
			continue
		}
		asset.Versions[index].Validation = validation
		asset.UpdatedAt = time.Now().UTC()
		s.assets[assetID] = asset
		if err := s.persistLocked(); err != nil {
			return Version{}, err
		}
		return asset.Versions[index], nil
	}
	return Version{}, os.ErrNotExist
}

func (s *Store) SetGeometry(assetID, versionID string, geometry aicreate.Geometry) (Version, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	asset, ok := s.assets[assetID]
	if !ok {
		return Version{}, os.ErrNotExist
	}
	for index := range asset.Versions {
		if asset.Versions[index].ID != versionID {
			continue
		}
		copy := geometry
		asset.Versions[index].Geometry = &copy
		asset.UpdatedAt = time.Now().UTC()
		s.assets[assetID] = asset
		if err := s.persistLocked(); err != nil {
			return Version{}, err
		}
		return asset.Versions[index], nil
	}
	return Version{}, os.ErrNotExist
}

func (s *Store) writeVersion(assetID string, number int, fileName, unit, source, prompt, parentVersionID string, input io.Reader) (Version, error) {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))
	if ext != ".step" && ext != ".stp" {
		return Version{}, errors.New("only .step and .stp files can be stored in the STEP library")
	}
	unit = strings.TrimSpace(unit)
	if unit == "" {
		unit = "m"
	}
	if unit != "m" && unit != "mm" && unit != "cm" && unit != "inch" {
		return Version{}, errors.New("STEP unit must be m, mm, cm, or inch")
	}
	versionID, err := newID("stepv")
	if err != nil {
		return Version{}, err
	}
	directory := filepath.Join(s.root, "files", assetID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return Version{}, err
	}
	temporary, err := os.CreateTemp(directory, ".upload-*.step")
	if err != nil {
		return Version{}, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	hash := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(temporary, hash), input)
	closeErr := temporary.Close()
	if copyErr != nil {
		return Version{}, copyErr
	}
	if closeErr != nil {
		return Version{}, closeErr
	}
	if size == 0 {
		return Version{}, errors.New("STEP file is empty")
	}
	finalPath := s.versionPath(assetID, versionID)
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return Version{}, err
	}
	return Version{
		ID: versionID, AssetID: assetID, Number: number,
		FileName: filepath.Base(fileName), Unit: unit, Size: size, SHA256: hex.EncodeToString(hash.Sum(nil)),
		Source: firstNonEmpty(strings.TrimSpace(source), "upload"), Prompt: strings.TrimSpace(prompt),
		ParentVersionID: strings.TrimSpace(parentVersionID), Validation: Validation{Status: StatusValidating},
		CreatedAt: time.Now().UTC(),
	}, nil
}

func (s *Store) versionPath(assetID, versionID string) string {
	return filepath.Join(s.root, "files", assetID, versionID+".step")
}

func (s *Store) persistLocked() error {
	payload, err := json.MarshalIndent(index{Assets: s.assets, Jobs: s.jobs}, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(s.root, ".index-*.json")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
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
	return os.Rename(temporaryPath, s.indexPath)
}

func cloneAsset(asset Asset) Asset {
	asset.Versions = append([]Version(nil), asset.Versions...)
	return asset
}

func newID(prefix string) (string, error) {
	raw := make([]byte, 9)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + "-" + hex.EncodeToString(raw), nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
