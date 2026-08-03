package imports

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
)

const (
	MaxFileSizeDefault  int64         = 2 * 1024 * 1024 * 1024 // 2 GB per file
	MaxTotalSizeDefault int64         = 5 * 1024 * 1024 * 1024 // 5 GB total
	MaxFileCountDefault               = 20
	DefaultCleanupAge   time.Duration = 24 * time.Hour
)

var supportedLengthUnits = map[string]struct{}{
	"m":    {},
	"mm":   {},
	"cm":   {},
	"inch": {},
}

// IsSupportedLengthUnit reports whether unit is a canonical Flow360 import
// token. Import callers should never persist arbitrary user-entered units.
func IsSupportedLengthUnit(unit string) bool {
	_, ok := supportedLengthUnits[unit]
	return ok
}

type FileInfo struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"size_bytes"`
	Hash      string `json:"hash"`
	MimeType  string `json:"mime_type"`
}

type Plan struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	SourceType    string          `json:"source_type"`
	Unit          string          `json:"unit"`
	UnitConfirmed bool            `json:"unit_confirmed"`
	Workflow      string          `json:"workflow"`
	SolverVersion string          `json:"solver_version,omitempty"`
	FolderID      string          `json:"folder_id,omitempty"`
	Tags          []string        `json:"tags,omitempty"`
	Files         []FileInfo      `json:"files"`
	SizeBytes     int64           `json:"size_bytes"`
	ContentHash   string          `json:"content_hash"`
	Status        string          `json:"status"`
	Command       []string        `json:"command_preview"`
	Result        json.RawMessage `json:"result,omitempty"`
	Error         string          `json:"error,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

type Store struct {
	dir          string
	maxFileSize  int64
	maxTotalSize int64
	maxFileCount int
	mu           sync.Mutex
}

func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{
		dir:          dir,
		maxFileSize:  MaxFileSizeDefault,
		maxTotalSize: MaxTotalSizeDefault,
		maxFileCount: MaxFileCountDefault,
	}, nil
}

func NewWithLimits(dir string, maxFileSize, maxTotalSize int64, maxFileCount int) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{
		dir:          dir,
		maxFileSize:  maxFileSize,
		maxTotalSize: maxTotalSize,
		maxFileCount: maxFileCount,
	}, nil
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

func (s *Store) AddFile(planID string, filename string, reader io.Reader) (FileInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !strings.HasPrefix(planID, "import-") || strings.ContainsAny(planID, `/\`) {
		return FileInfo{}, errors.New("invalid import id")
	}

	cleanName := filepath.Base(filename)
	if cleanName == "." || cleanName == "" || cleanName == ".." {
		return FileInfo{}, errors.New("invalid filename")
	}
	if strings.Contains(cleanName, "..") {
		return FileInfo{}, errors.New("invalid filename: path traversal not allowed")
	}

	filesDir := filepath.Join(s.dir, planID, "files")
	targetPath := filepath.Join(filesDir, cleanName)

	if err := s.validateFilePath(filesDir, targetPath); err != nil {
		return FileInfo{}, err
	}

	stat, err := os.Lstat(targetPath)
	if err == nil && stat.Mode()&os.ModeSymlink != 0 {
		return FileInfo{}, errors.New("symbolic links are not allowed")
	}

	f, err := os.OpenFile(targetPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return FileInfo{}, fmt.Errorf("could not create file: %w", err)
	}
	defer f.Close()

	hasher := sha256.New()
	var totalSize int64
	buf := make([]byte, 64*1024)
	mimeBuf := make([]byte, 512)
	var mimeLen int

	for {
		n, readErr := reader.Read(buf)
		if n > 0 {
			if totalSize+int64(n) > s.maxFileSize {
				return FileInfo{}, fmt.Errorf("file exceeds maximum size of %d bytes", s.maxFileSize)
			}
			if totalSize+int64(n) > s.maxTotalSize {
				return FileInfo{}, fmt.Errorf("total upload exceeds maximum size of %d bytes", s.maxTotalSize)
			}

			chunk := buf[:n]
			hasher.Write(chunk)

			if mimeLen < len(mimeBuf) {
				remaining := len(mimeBuf) - mimeLen
				toCopy := min(n, remaining)
				copy(mimeBuf[mimeLen:], chunk[:toCopy])
				mimeLen += toCopy
			}

			if _, writeErr := f.Write(chunk); writeErr != nil {
				os.Remove(targetPath)
				return FileInfo{}, writeErr
			}
			totalSize += int64(n)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			os.Remove(targetPath)
			return FileInfo{}, readErr
		}
	}

	hashBytes := hasher.Sum(nil)
	mimeType := detectMIME(mimeBuf[:mimeLen])

	return FileInfo{
		Name:      cleanName,
		SizeBytes: totalSize,
		Hash:      hex.EncodeToString(hashBytes),
		MimeType:  mimeType,
	}, nil
}

func (s *Store) FinalizePlan(id string, files []FileInfo, totalSize int64, command []string) (Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	plan, err := s.read(id)
	if err != nil {
		return Plan{}, err
	}

	plan.Files = files
	plan.SizeBytes = totalSize
	plan.ContentHash = computeContentHash(files)
	plan.Command = command
	plan.UpdatedAt = time.Now().UTC()

	if len(plan.Files) > s.maxFileCount {
		return Plan{}, fmt.Errorf("exceeds maximum file count of %d", s.maxFileCount)
	}

	return plan, s.write(plan)
}

func (s *Store) Get(id string) (Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(id)
}

func (s *Store) List(folderID string, statusFilter string) ([]Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}

	var plans []Plan
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "import-") {
			continue
		}
		plan, err := s.read(entry.Name())
		if err != nil {
			continue
		}
		if folderID != "" && plan.FolderID != folderID {
			continue
		}
		if statusFilter != "" && plan.Status != statusFilter {
			continue
		}
		plans = append(plans, plan)
	}

	sort.Slice(plans, func(i, j int) bool {
		return plans[j].UpdatedAt.Before(plans[i].UpdatedAt)
	})

	return plans, nil
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

// Start atomically reserves an import for execution. It rejects another
// running or submitted import only when both the uploaded content and all
// Flow360 creation options are identical. This keeps retries idempotent
// without blocking legitimate imports of the same files with new settings.
func (s *Store) Start(id string) (Plan, *Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	plan, err := s.read(id)
	if err != nil {
		return Plan{}, nil, err
	}
	if plan.Status != "approved" && plan.Status != "failed" {
		return Plan{}, nil, errors.New("import must be approved before execution")
	}
	if !IsSupportedLengthUnit(plan.Unit) {
		return Plan{}, nil, errors.New("import has an unsupported length unit")
	}

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return Plan{}, nil, err
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == plan.ID || !strings.HasPrefix(entry.Name(), "import-") {
			continue
		}
		existing, readErr := s.read(entry.Name())
		if readErr != nil {
			continue
		}
		if (existing.Status == "running" || existing.Status == "submitted") && sameExecution(existing, plan) {
			return plan, &existing, nil
		}
	}

	plan.Status = "running"
	plan.Error = ""
	plan.UpdatedAt = time.Now().UTC()
	if err := s.write(plan); err != nil {
		return Plan{}, nil, err
	}
	return plan, nil, nil
}

func (s *Store) FindByContentHash(hash string) (Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return Plan{}, err
	}

	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "import-") {
			continue
		}
		plan, err := s.read(entry.Name())
		if err != nil {
			continue
		}
		if plan.ContentHash == hash && plan.Status == "submitted" {
			return plan, nil
		}
	}

	return Plan{}, errors.New("no existing import with this content hash")
}

func sameExecution(a, b Plan) bool {
	if a.ContentHash == "" || a.ContentHash != b.ContentHash {
		return false
	}
	if a.Name != b.Name ||
		a.SourceType != b.SourceType ||
		a.Unit != b.Unit ||
		a.Workflow != b.Workflow ||
		a.SolverVersion != b.SolverVersion ||
		a.FolderID != b.FolderID {
		return false
	}
	if len(a.Tags) != len(b.Tags) {
		return false
	}
	aTags := append([]string(nil), a.Tags...)
	bTags := append([]string(nil), b.Tags...)
	sort.Strings(aTags)
	sort.Strings(bTags)
	for i := range aTags {
		if aTags[i] != bTags[i] {
			return false
		}
	}
	return true
}

func (s *Store) FilePaths(plan Plan) []string {
	result := make([]string, 0, len(plan.Files))
	for _, file := range plan.Files {
		result = append(result, filepath.Join(s.dir, plan.ID, "files", file.Name))
	}
	return result
}

func (s *Store) Cleanup(maxAge time.Duration) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().UTC().Add(-maxAge)
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return 0, err
	}

	cleaned := 0
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "import-") {
			continue
		}
		plan, err := s.read(entry.Name())
		if err != nil {
			os.RemoveAll(filepath.Join(s.dir, entry.Name()))
			cleaned++
			continue
		}
		if plan.Status == "draft" || plan.Status == "failed" {
			if plan.UpdatedAt.Before(cutoff) {
				os.RemoveAll(filepath.Join(s.dir, entry.Name()))
				cleaned++
			}
		}
	}

	return cleaned, nil
}

func (s *Store) read(id string) (Plan, error) {
	if err := s.validateID(id); err != nil {
		return Plan{}, err
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
	if err := s.validateID(id); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(s.dir, id))
}

func (s *Store) FilesDir(planID string) string {
	return filepath.Join(s.dir, planID, "files")
}

func (s *Store) validateID(id string) error {
	if !strings.HasPrefix(id, "import-") || strings.ContainsAny(id, `/\`) {
		return errors.New("invalid import id")
	}
	cleaned := filepath.Clean(id)
	if cleaned != id {
		return errors.New("invalid import id")
	}
	return nil
}

func (s *Store) validateFilePath(filesDir, targetPath string) error {
	absFilesDir, err := filepath.Abs(filesDir)
	if err != nil {
		return err
	}
	absTargetPath, err := filepath.Abs(targetPath)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(absTargetPath, absFilesDir+string(os.PathSeparator)) {
		return errors.New("file path escapes files directory")
	}
	cleanTarget := filepath.Clean(absTargetPath)
	if !strings.HasPrefix(cleanTarget, absFilesDir+string(os.PathSeparator)) {
		return errors.New("file path escapes files directory")
	}
	return nil
}

func detectMIME(data []byte) string {
	if len(data) == 0 {
		return "application/octet-stream"
	}
	switch {
	case len(data) >= 4 && string(data[:4]) == "CGNS":
		return "application/x-cgns"
	case len(data) >= 4 && string(data[:4]) == "ADF\x00":
		return "application/x-cgns"
	case len(data) >= 4 && string(data[:4]) == "HDF5":
		return "application/x-hdf5"
	case len(data) >= 5 && (string(data[:5]) == "$CASE" || string(data[:5]) == "$DATA" || string(data[:5]) == "$GRID"):
		return "text/ascii-nastran"
	case len(data) >= 2 && (data[0] == 0x00 && data[1] == 0x00):
		return "application/binary"
	case len(data) >= 4 && string(data[:4]) == "VTK\x00":
		return "application/x-vtk"
	case len(data) >= 2 && data[0] == 'P' && data[1] == 'F':
		return "text/x-step"
	default:
		return "application/octet-stream"
	}
}

func computeContentHash(files []FileInfo) string {
	h := sha256.New()
	for _, f := range files {
		h.Write([]byte(f.Hash))
	}
	return hex.EncodeToString(h.Sum(nil))
}
