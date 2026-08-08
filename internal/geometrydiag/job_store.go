package geometrydiag

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

type JobStatus string

const (
	JobQueued    JobStatus = "queued"
	JobRunning   JobStatus = "running"
	JobCompleted JobStatus = "completed"
	JobFailed    JobStatus = "failed"
	JobCancelled JobStatus = "cancelled"
)

type Job struct {
	ID         string     `json:"id"`
	GeometryID string     `json:"geometry_id"`
	CacheKey   string     `json:"cache_key"`
	Status     JobStatus  `json:"status"`
	Progress   int        `json:"progress"`
	Stage      string     `json:"stage"`
	Settings   Settings   `json:"settings"`
	Report     *Report    `json:"report,omitempty"`
	Error      string     `json:"error,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

type JobStore struct {
	mu       sync.Mutex
	root     string
	jobsDir  string
	cacheDir string
	jobs     map[string]Job
}

var validJobID = regexp.MustCompile(`^geometry-diagnostic-[a-f0-9]{24}$`)

func NewJobStore(root string) (*JobStore, error) {
	store := &JobStore{
		root: root, jobsDir: filepath.Join(root, "jobs"), cacheDir: filepath.Join(root, "cache"),
		jobs: map[string]Job{},
	}
	for _, dir := range []string{store.jobsDir, store.cacheDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, err
		}
	}
	entries, err := os.ReadDir(store.jobsDir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		payload, readErr := os.ReadFile(filepath.Join(store.jobsDir, entry.Name()))
		if readErr != nil {
			continue
		}
		var job Job
		if json.Unmarshal(payload, &job) != nil || !validJobID.MatchString(job.ID) {
			continue
		}
		if job.Status == JobQueued || job.Status == JobRunning {
			now := time.Now().UTC()
			job.Status = JobFailed
			job.Stage = "interrupted"
			job.Error = "diagnostic interrupted by server restart; start a new job"
			job.UpdatedAt = now
			job.FinishedAt = &now
			_ = store.writeJob(job)
		}
		store.jobs[job.ID] = job
	}
	return store, nil
}

func (s *JobStore) Create(geometryID, cacheKey string, settings Settings) (Job, error) {
	id, err := newJobID()
	if err != nil {
		return Job{}, err
	}
	now := time.Now().UTC()
	job := Job{ID: id, GeometryID: geometryID, CacheKey: cacheKey, Status: JobQueued, Progress: 0, Stage: "queued", Settings: NormalizeSettings(settings), CreatedAt: now, UpdatedAt: now}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.writeJob(job); err != nil {
		return Job{}, err
	}
	s.jobs[id] = job
	return job, nil
}

func (s *JobStore) Get(id string) (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	return job, ok
}

func (s *JobStore) LatestCompleted(geometryID string) (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest Job
	found := false
	for _, job := range s.jobs {
		if job.GeometryID != geometryID || job.Status != JobCompleted || job.Report == nil {
			continue
		}
		if !found || job.UpdatedAt.After(latest.UpdatedAt) {
			latest, found = job, true
		}
	}
	return latest, found
}

func (s *JobStore) Update(id string, progress int, stage string) (Job, error) {
	return s.change(id, func(job *Job) error {
		if terminal(job.Status) {
			return errors.New("diagnostic job is already finished")
		}
		job.Status = JobRunning
		if progress < 0 {
			progress = 0
		}
		if progress > 99 {
			progress = 99
		}
		job.Progress = progress
		job.Stage = stage
		return nil
	})
}

func (s *JobStore) Complete(id string, report Report) (Job, error) {
	return s.change(id, func(job *Job) error {
		if job.Status == JobCancelled {
			return errors.New("diagnostic job was cancelled")
		}
		now := time.Now().UTC()
		job.Status = JobCompleted
		job.Progress = 100
		job.Stage = "completed"
		job.Report = &report
		job.Error = ""
		job.FinishedAt = &now
		return nil
	})
}

func (s *JobStore) Fail(id string, cause error) (Job, error) {
	return s.change(id, func(job *Job) error {
		if job.Status == JobCancelled {
			return nil
		}
		now := time.Now().UTC()
		job.Status = JobFailed
		job.Stage = "failed"
		job.Error = cause.Error()
		job.FinishedAt = &now
		return nil
	})
}

func (s *JobStore) Cancel(id string) (Job, error) {
	return s.change(id, func(job *Job) error {
		if terminal(job.Status) {
			return errors.New("diagnostic job is already finished")
		}
		now := time.Now().UTC()
		job.Status = JobCancelled
		job.Stage = "cancelled"
		job.Error = ""
		job.FinishedAt = &now
		return nil
	})
}

func (s *JobStore) IsCancelled(id string) bool {
	job, ok := s.Get(id)
	return ok && job.Status == JobCancelled
}

func (s *JobStore) GetCached(key string) (Report, bool) {
	payload, err := os.ReadFile(s.cachePath(key))
	if err != nil {
		return Report{}, false
	}
	var report Report
	if json.Unmarshal(payload, &report) != nil || report.Fingerprint == "" {
		return Report{}, false
	}
	return report, true
}

func (s *JobStore) PutCached(key string, report Report) error {
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(s.cachePath(key), payload)
}

func (s *JobStore) change(id string, update func(*Job) error) (Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return Job{}, os.ErrNotExist
	}
	if err := update(&job); err != nil {
		return job, err
	}
	job.UpdatedAt = time.Now().UTC()
	if err := s.writeJob(job); err != nil {
		return Job{}, err
	}
	s.jobs[id] = job
	return job, nil
}

func (s *JobStore) writeJob(job Job) error {
	payload, err := json.MarshalIndent(job, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(s.jobsDir, job.ID+".json"), payload)
}

func (s *JobStore) cachePath(key string) string {
	digest := sha256.Sum256([]byte(key))
	return filepath.Join(s.cacheDir, hex.EncodeToString(digest[:])+".json")
}

func atomicWrite(path string, payload []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".geometry-diagnostic-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func newJobID() (string, error) {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate diagnostic job ID: %w", err)
	}
	return "geometry-diagnostic-" + hex.EncodeToString(bytes), nil
}

func terminal(status JobStatus) bool {
	return status == JobCompleted || status == JobFailed || status == JobCancelled
}
