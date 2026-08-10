package sliceplayer

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

type Report struct {
	IndexVersion      int            `json:"index_version"`
	CompressedBytes   int64          `json:"compressed_bytes"`
	UncompressedBytes int64          `json:"uncompressed_bytes"`
	EntryCount        int            `json:"entry_count"`
	Slices            []SliceSummary `json:"slices"`
	Formats           []string       `json:"formats"`
	IndexReady        bool           `json:"index_ready"`
	Playback          *Playback      `json:"playback,omitempty"`
}

type Job struct {
	ID         string     `json:"id"`
	CaseID     string     `json:"case_id"`
	ResultPath string     `json:"result_path"`
	SourceSize int64      `json:"source_size"`
	CacheKey   string     `json:"cache_key"`
	Status     JobStatus  `json:"status"`
	Progress   int        `json:"progress"`
	Stage      string     `json:"stage"`
	Report     *Report    `json:"report,omitempty"`
	Error      string     `json:"error,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

type Store struct {
	mu                      sync.Mutex
	root, jobsDir, cacheDir string
	jobs                    map[string]Job
}

var validJobID = regexp.MustCompile(`^slice-player-[a-f0-9]{24}$`)

func NewStore(root string) (*Store, error) {
	store := &Store{root: root, jobsDir: filepath.Join(root, "jobs"), cacheDir: filepath.Join(root, "cache"), jobs: map[string]Job{}}
	for _, directory := range []string{store.jobsDir, store.cacheDir} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
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
			job.Error = "time-series preparation was interrupted by server restart; start it again"
			job.UpdatedAt = now
			job.FinishedAt = &now
			_ = store.writeJob(job)
		}
		store.jobs[job.ID] = job
	}
	return store, nil
}

func CacheKey(caseID, resultPath string, size int64) string {
	return fmt.Sprintf("v%d:%s:%s:%d", IndexVersion, caseID, resultPath, size)
}

func (s *Store) Create(caseID, resultPath string, sourceSize int64, cacheKey string) (Job, error) {
	idBytes := make([]byte, 12)
	if _, err := rand.Read(idBytes); err != nil {
		return Job{}, err
	}
	now := time.Now().UTC()
	job := Job{ID: "slice-player-" + hex.EncodeToString(idBytes), CaseID: caseID, ResultPath: resultPath, SourceSize: sourceSize, CacheKey: cacheKey, Status: JobQueued, Stage: "queued", CreatedAt: now, UpdatedAt: now}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.writeJob(job); err != nil {
		return Job{}, err
	}
	s.jobs[job.ID] = job
	return job, nil
}

func (s *Store) Get(id string) (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	return job, ok
}

func (s *Store) Latest(caseID string) (Job, bool) {
	return s.LatestForResultPath(caseID, "")
}

func (s *Store) LatestForResultPath(caseID, resultPath string) (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest Job
	found := false
	for _, job := range s.jobs {
		if job.CaseID == caseID && (resultPath == "" || job.ResultPath == resultPath) && (!found || job.UpdatedAt.After(latest.UpdatedAt)) {
			latest, found = job, true
		}
	}
	return latest, found
}

func (s *Store) Update(id string, progress int, stage string) (Job, error) {
	return s.change(id, func(job *Job) error {
		if terminal(job.Status) {
			return errors.New("time-series preparation is already finished")
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

func (s *Store) Complete(id string, index Index, playback *Playback) (Job, error) {
	if err := s.putIndex(index, s.cacheKeyForJob(id)); err != nil {
		return Job{}, err
	}
	if playback != nil {
		if err := s.putPlayback(*playback, s.cacheKeyForJob(id)); err != nil {
			return Job{}, err
		}
	}
	report := Report{IndexVersion: index.Version, CompressedBytes: index.CompressedBytes, UncompressedBytes: index.UncompressedBytes, EntryCount: index.EntryCount, Slices: index.Slices, Formats: index.Formats, IndexReady: true, Playback: playback}
	return s.change(id, func(job *Job) error {
		if job.Status == JobCancelled {
			return errors.New("time-series preparation was cancelled")
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

func (s *Store) Fail(id string, cause error) (Job, error) {
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
func (s *Store) Cancel(id string) (Job, error) {
	return s.change(id, func(job *Job) error {
		if terminal(job.Status) {
			return errors.New("time-series preparation is already finished")
		}
		now := time.Now().UTC()
		job.Status = JobCancelled
		job.Stage = "cancelled"
		job.FinishedAt = &now
		return nil
	})
}
func (s *Store) IsCancelled(id string) bool {
	job, ok := s.Get(id)
	return ok && job.Status == JobCancelled
}

func (s *Store) Cached(cacheKey string) (Index, bool) {
	payload, err := os.ReadFile(s.indexPath(cacheKey))
	if err != nil {
		return Index{}, false
	}
	var index Index
	if json.Unmarshal(payload, &index) != nil || index.Version != IndexVersion {
		return Index{}, false
	}
	return index, true
}

func (s *Store) CachedPlayback(cacheKey string) (*Playback, bool) {
	payload, err := os.ReadFile(filepath.Join(s.cacheDirectory(cacheKey), "playback.json"))
	if err != nil {
		return nil, false
	}
	var playback Playback
	if json.Unmarshal(payload, &playback) != nil || !playback.Ready {
		return nil, false
	}
	return &playback, true
}

func (s *Store) AssetDirectory(cacheKey string) (string, error) {
	directory := filepath.Join(s.cacheDirectory(cacheKey), "assets")
	return directory, os.MkdirAll(directory, 0o700)
}

func (s *Store) AssetPath(jobID, relative string) (string, error) {
	job, ok := s.Get(jobID)
	if !ok {
		return "", os.ErrNotExist
	}
	clean, err := safeArchivePath(relative)
	if err != nil {
		return "", err
	}
	target := filepath.Join(s.cacheDirectory(job.CacheKey), "assets", filepath.FromSlash(clean))
	info, err := os.Lstat(target)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("slice player asset is not a regular file")
	}
	return target, nil
}

func (s *Store) change(id string, update func(*Job) error) (Job, error) {
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

func (s *Store) writeJob(job Job) error {
	payload, err := json.MarshalIndent(job, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(s.jobsDir, job.ID+".json"), payload)
}
func (s *Store) putIndex(index Index, cacheKey string) error {
	payload, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.cacheDirectory(cacheKey), 0o700); err != nil {
		return err
	}
	return atomicWrite(s.indexPath(cacheKey), payload)
}
func (s *Store) putPlayback(playback Playback, cacheKey string) error {
	payload, err := json.MarshalIndent(playback, "", "  ")
	if err != nil {
		return err
	}
	directory := s.cacheDirectory(cacheKey)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	return atomicWrite(filepath.Join(directory, "playback.json"), payload)
}
func (s *Store) cacheKeyForJob(id string) string {
	job, ok := s.Get(id)
	if !ok {
		return "missing"
	}
	return job.CacheKey
}
func (s *Store) indexPath(cacheKey string) string {
	return filepath.Join(s.cacheDirectory(cacheKey), "index.json")
}
func (s *Store) cacheDirectory(cacheKey string) string {
	digest := sha256.Sum256([]byte(cacheKey))
	return filepath.Join(s.cacheDir, hex.EncodeToString(digest[:]))
}

func atomicWrite(target string, payload []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(target), ".slice-player-*")
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
	return os.Rename(name, target)
}

func terminal(status JobStatus) bool {
	return status == JobCompleted || status == JobFailed || status == JobCancelled
}
