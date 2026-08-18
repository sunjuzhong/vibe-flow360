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
	"sort"
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
	IndexVersion      int                 `json:"index_version"`
	CompressedBytes   int64               `json:"compressed_bytes"`
	UncompressedBytes int64               `json:"uncompressed_bytes"`
	EntryCount        int                 `json:"entry_count"`
	Slices            []SliceSummary      `json:"slices"`
	Formats           []string            `json:"formats"`
	IndexReady        bool                `json:"index_ready"`
	PartialReady      bool                `json:"partial_ready,omitempty"`
	Playback          *Playback           `json:"playback,omitempty"`
	Metrics           *PreparationMetrics `json:"metrics,omitempty"`
}

type PreparationMetrics struct {
	CacheHit                 bool  `json:"cache_hit"`
	DownloadMilliseconds     int64 `json:"download_milliseconds"`
	PrepareMilliseconds      int64 `json:"prepare_milliseconds"`
	PersistMilliseconds      int64 `json:"persist_milliseconds"`
	CacheRestoreMilliseconds int64 `json:"cache_restore_milliseconds"`
	TotalMilliseconds        int64 `json:"total_milliseconds"`
}

type CacheCleanupResult struct {
	RemovedEntries int
	RemovedBytes   int64
	RemainingBytes int64
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
	mu                                  sync.Mutex
	root, jobsDir, cacheDir, archiveDir string
	jobs                                map[string]Job
	leases                              map[string]int
	accesses                            map[string]time.Time
}

var validJobID = regexp.MustCompile(`^slice-player-[a-f0-9]{24}$`)

func NewStore(root string) (*Store, error) {
	store := &Store{root: root, jobsDir: filepath.Join(root, "jobs"), cacheDir: filepath.Join(root, "cache"), archiveDir: filepath.Join(root, "archives"), jobs: map[string]Job{}, leases: map[string]int{}, accesses: map[string]time.Time{}}
	for _, directory := range []string{store.jobsDir, store.cacheDir, store.archiveDir} {
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
			job.Status = JobQueued
			job.Progress = 0
			job.Stage = "recovering"
			job.Error = ""
			job.UpdatedAt = now
			job.FinishedAt = nil
			_ = store.writeJob(job)
		}
		if store.upgradePlaybackFrameRanges(&job) {
			_ = store.writeJob(job)
		}
		store.jobs[job.ID] = job
	}
	return store, nil
}

func (s *Store) upgradePlaybackFrameRanges(job *Job) bool {
	if job.Report == nil || job.Report.IndexVersion >= IndexVersion || job.Report.Playback == nil || !job.Report.Playback.Ready {
		return false
	}
	playback := job.Report.Playback
	ranges := make([]map[string][2]float64, len(playback.Frames))
	for frameIndex, frame := range playback.Frames {
		manifestPath := filepath.Join(s.cacheDirectory(job.CacheKey), "assets", filepath.FromSlash(frame.ManifestPath))
		payload, err := os.ReadFile(manifestPath)
		if err != nil {
			return false
		}
		var entries []struct {
			Resources struct {
				Buffers struct {
					Bounds map[string][2]float64 `json:"bounds"`
				} `json:"buffers"`
			} `json:"resources"`
		}
		if json.Unmarshal(payload, &entries) != nil {
			return false
		}
		frameRanges := map[string][2]float64{}
		for _, entry := range entries {
			for field, bounds := range entry.Resources.Buffers.Bounds {
				previous, exists := frameRanges[field]
				if !exists {
					frameRanges[field] = bounds
					continue
				}
				if bounds[0] < previous[0] {
					previous[0] = bounds[0]
				}
				if bounds[1] > previous[1] {
					previous[1] = bounds[1]
				}
				frameRanges[field] = previous
			}
		}
		if len(frame.Fields) > 0 && len(frameRanges) == 0 {
			return false
		}
		ranges[frameIndex] = frameRanges
	}
	for frameIndex := range playback.Frames {
		playback.Frames[frameIndex].FieldRanges = ranges[frameIndex]
	}
	job.Report.IndexVersion = IndexVersion
	return true
}

func CacheKey(caseID, resultPath string, size int64) string {
	return fmt.Sprintf("v%d:%s:%s:%d", IndexVersion, caseID, resultPath, size)
}

func SourceKey(caseID, resultPath string, size int64) string {
	return fmt.Sprintf("source:%s:%s:%d", caseID, resultPath, size)
}

func (s *Store) ArchiveDirectory(sourceKey string) (string, error) {
	directory := s.archiveDirectory(sourceKey)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return directory, err
	}
	s.touchDirectory(directory)
	return directory, nil
}

// ReusableArchive adopts an exact immutable archive from the current store or
// from the pre-namespace download layout without copying its potentially huge
// contents. The legacy path is linked into the managed archive directory so
// subsequent jobs use the normal cache lifecycle.
func (s *Store) ReusableArchive(caseID, resultPath string, sourceSize int64) (string, bool, error) {
	if sourceSize <= 0 {
		return "", false, nil
	}
	name := filepath.Base(resultPath)
	if name == "." || name == "" || name == ".." {
		return "", false, errors.New("invalid time-series archive path")
	}
	targetDirectory, err := s.ArchiveDirectory(SourceKey(caseID, resultPath, sourceSize))
	if err != nil {
		return "", false, err
	}
	target := filepath.Join(targetDirectory, name)
	if exactRegularFile(target, sourceSize) {
		return target, true, nil
	}

	s.mu.Lock()
	jobIDs := make([]string, 0)
	for _, job := range s.jobs {
		if job.CaseID == caseID && job.ResultPath == resultPath && job.SourceSize == sourceSize && validJobID.MatchString(job.ID) {
			jobIDs = append(jobIDs, job.ID)
		}
	}
	s.mu.Unlock()
	sort.Strings(jobIDs)
	legacyDownloads := filepath.Join(filepath.Dir(s.root), "downloads")
	for _, jobID := range jobIDs {
		candidate := filepath.Join(legacyDownloads, jobID, name)
		if !exactRegularFile(candidate, sourceSize) {
			continue
		}
		if err := os.Link(candidate, target); err != nil && !errors.Is(err, os.ErrExist) {
			// A cross-device or read-only legacy cache is still safe to consume in place.
			return candidate, true, nil
		}
		if exactRegularFile(target, sourceSize) {
			_ = os.Chmod(target, 0o600)
			return target, true, nil
		}
	}
	return "", false, nil
}

func exactRegularFile(path string, expectedSize int64) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular() && info.Size() == expectedSize
}

func (s *Store) RecoverableJobs() []Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs := make([]Job, 0)
	for _, job := range s.jobs {
		if job.Status == JobQueued {
			jobs = append(jobs, job)
		}
	}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].CreatedAt.Before(jobs[j].CreatedAt) })
	return jobs
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
	return s.CompleteWithMetrics(id, index, playback, PreparationMetrics{})
}

func (s *Store) CompleteWithMetrics(id string, index Index, playback *Playback, metrics PreparationMetrics) (Job, error) {
	job, ok := s.Get(id)
	if !ok {
		return Job{}, errors.New("time-series preparation job was not found")
	}
	if job.Status == JobCancelled {
		return Job{}, errors.New("time-series preparation was cancelled")
	}
	cacheKey := job.CacheKey
	persistStarted := time.Now()
	if err := s.putIndex(index, cacheKey); err != nil {
		return Job{}, err
	}
	if playback != nil {
		if err := s.putPlayback(*playback, cacheKey); err != nil {
			return Job{}, err
		}
		_ = os.Remove(filepath.Join(s.cacheDirectory(cacheKey), "playback.partial.json"))
	}
	metrics.PersistMilliseconds += elapsedMilliseconds(persistStarted)
	metrics.TotalMilliseconds = metrics.DownloadMilliseconds + metrics.PrepareMilliseconds + metrics.PersistMilliseconds + metrics.CacheRestoreMilliseconds
	report := Report{IndexVersion: index.Version, CompressedBytes: index.CompressedBytes, UncompressedBytes: index.UncompressedBytes, EntryCount: index.EntryCount, Slices: index.Slices, Formats: index.Formats, IndexReady: true, Playback: playback, Metrics: &metrics}
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

func (s *Store) PublishPartial(id string, index Index, playback Playback) (Job, error) {
	if !playback.Ready || playback.FrameCount == 0 {
		return Job{}, errors.New("partial playback must contain at least one complete frame")
	}
	job, ok := s.Get(id)
	if !ok {
		return Job{}, errors.New("time-series preparation job was not found")
	}
	if terminal(job.Status) {
		return Job{}, errors.New("time-series preparation is already finished")
	}
	cacheKey := job.CacheKey
	if err := s.putPartialPlayback(playback, cacheKey); err != nil {
		return Job{}, err
	}
	report := Report{
		IndexVersion: index.Version, CompressedBytes: index.CompressedBytes,
		UncompressedBytes: index.UncompressedBytes, EntryCount: index.EntryCount,
		Slices: index.Slices, Formats: index.Formats, IndexReady: false,
		PartialReady: true, Playback: &playback,
	}
	return s.change(id, func(job *Job) error {
		if terminal(job.Status) {
			return errors.New("time-series preparation is already finished")
		}
		job.Status = JobRunning
		job.Stage = "preparing-remaining-frames"
		job.Report = &report
		job.Error = ""
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
	s.touchDirectory(s.cacheDirectory(cacheKey))
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
	s.touchDirectory(s.cacheDirectory(cacheKey))
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
	s.touchDirectory(s.cacheDirectory(job.CacheKey))
	return target, nil
}

func (s *Store) Protect(jobID string) (func(), bool) {
	s.mu.Lock()
	job, ok := s.jobs[jobID]
	if !ok {
		s.mu.Unlock()
		return func() {}, false
	}
	paths := []string{s.cacheDirectory(job.CacheKey), s.archiveDirectory(SourceKey(job.CaseID, job.ResultPath, job.SourceSize))}
	for _, path := range paths {
		s.leases[path]++
	}
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, path := range paths {
			s.leases[path]--
			if s.leases[path] <= 0 {
				delete(s.leases, path)
			}
		}
	}, true
}

func (s *Store) Cleanup(maxBytes int64, retention time.Duration) (CacheCleanupResult, error) {
	candidates, total, err := s.cacheCandidates()
	if err != nil {
		return CacheCleanupResult{}, err
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].accessed.Before(candidates[j].accessed) })
	result := CacheCleanupResult{RemainingBytes: total}
	cutoff := time.Now().UTC().Add(-retention)
	for _, candidate := range candidates {
		expired := retention > 0 && candidate.accessed.Before(cutoff)
		overQuota := maxBytes > 0 && result.RemainingBytes > maxBytes
		if !expired && !overQuota {
			continue
		}
		removed, removeErr := s.removeCacheCandidate(candidate.path, candidate.cache)
		if removeErr != nil {
			return result, removeErr
		}
		if !removed {
			continue
		}
		result.RemovedEntries++
		result.RemovedBytes += candidate.bytes
		result.RemainingBytes -= candidate.bytes
	}
	return result, nil
}

type cacheCandidate struct {
	path     string
	bytes    int64
	accessed time.Time
	cache    bool
}

func (s *Store) cacheCandidates() ([]cacheCandidate, int64, error) {
	var candidates []cacheCandidate
	var total int64
	for _, root := range []struct {
		path  string
		cache bool
	}{{s.cacheDir, true}, {s.archiveDir, false}} {
		entries, err := os.ReadDir(root.path)
		if err != nil {
			return nil, 0, err
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			path := filepath.Join(root.path, entry.Name())
			bytes, accessed, err := directoryUsage(path)
			if err != nil {
				continue
			}
			candidates = append(candidates, cacheCandidate{path: path, bytes: bytes, accessed: accessed, cache: root.cache})
			total += bytes
		}
	}
	return candidates, total, nil
}

func directoryUsage(root string) (int64, time.Time, error) {
	info, err := os.Stat(root)
	if err != nil {
		return 0, time.Time{}, err
	}
	accessed := info.ModTime()
	var bytes int64
	err = filepath.Walk(root, func(_ string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.Mode().IsRegular() {
			bytes += info.Size()
		}
		return nil
	})
	return bytes, accessed, err
}

func (s *Store) removeCacheCandidate(path string, cache bool) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.protectedLocked(path) {
		return false, nil
	}
	if err := os.RemoveAll(path); err != nil {
		return false, err
	}
	delete(s.accesses, path)
	if cache {
		for id, job := range s.jobs {
			if s.cacheDirectory(job.CacheKey) == path && terminal(job.Status) {
				delete(s.jobs, id)
				_ = os.Remove(filepath.Join(s.jobsDir, id+".json"))
			}
		}
	}
	return true, nil
}

func (s *Store) protectedLocked(path string) bool {
	if s.leases[path] > 0 {
		return true
	}
	for _, job := range s.jobs {
		if terminal(job.Status) {
			continue
		}
		if s.cacheDirectory(job.CacheKey) == path || s.archiveDirectory(SourceKey(job.CaseID, job.ResultPath, job.SourceSize)) == path {
			return true
		}
	}
	return false
}

func (s *Store) touchDirectory(path string) {
	now := time.Now()
	s.mu.Lock()
	if previous := s.accesses[path]; !previous.IsZero() && now.Sub(previous) < time.Minute {
		s.mu.Unlock()
		return
	}
	s.accesses[path] = now
	s.mu.Unlock()
	_ = os.Chtimes(path, now, now)
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
func (s *Store) putPartialPlayback(playback Playback, cacheKey string) error {
	payload, err := json.MarshalIndent(playback, "", "  ")
	if err != nil {
		return err
	}
	directory := s.cacheDirectory(cacheKey)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	return atomicWrite(filepath.Join(directory, "playback.partial.json"), payload)
}
func (s *Store) indexPath(cacheKey string) string {
	return filepath.Join(s.cacheDirectory(cacheKey), "index.json")
}
func (s *Store) cacheDirectory(cacheKey string) string {
	digest := sha256.Sum256([]byte(cacheKey))
	return filepath.Join(s.cacheDir, hex.EncodeToString(digest[:]))
}

func (s *Store) archiveDirectory(sourceKey string) string {
	digest := sha256.Sum256([]byte(sourceKey))
	return filepath.Join(s.archiveDir, hex.EncodeToString(digest[:]))
}

func elapsedMilliseconds(started time.Time) int64 {
	elapsed := time.Since(started)
	if elapsed > 0 && elapsed < time.Millisecond {
		return 1
	}
	return elapsed.Milliseconds()
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
