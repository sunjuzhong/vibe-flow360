package imports

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestIsSupportedLengthUnit(t *testing.T) {
	for _, unit := range []string{"m", "mm", "cm", "inch"} {
		if !IsSupportedLengthUnit(unit) {
			t.Fatalf("expected canonical unit %q to be supported", unit)
		}
	}
	for _, unit := range []string{"", "meter", "meters", "M", "ft"} {
		if IsSupportedLengthUnit(unit) {
			t.Fatalf("expected non-canonical unit %q to be rejected", unit)
		}
	}
}

func TestStore_CreateAndGet(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan := Plan{
		Name:       "test-import",
		SourceType: "geometry",
		Unit:       "m",
		Workflow:   "standard",
	}
	created, _, err := store.Create(plan)
	if err != nil {
		t.Fatal(err)
	}

	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Status != "draft" {
		t.Fatalf("expected status 'draft', got %q", created.Status)
	}

	got, err := store.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != plan.Name {
		t.Fatalf("expected name %q, got %q", plan.Name, got.Name)
	}
}

func TestStore_AddFile_StreamWrite(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan := Plan{Name: "test", SourceType: "geometry", Unit: "m"}
	created, _, err := store.Create(plan)
	if err != nil {
		t.Fatal(err)
	}

	content := []byte("test file content for import")
	reader := bytes.NewReader(content)
	info, err := store.AddFile(created.ID, "test.dat", reader)
	if err != nil {
		t.Fatal(err)
	}

	if info.Name != "test.dat" {
		t.Fatalf("expected name 'test.dat', got %q", info.Name)
	}
	if info.SizeBytes != int64(len(content)) {
		t.Fatalf("expected size %d, got %d", len(content), info.SizeBytes)
	}
	if info.Hash == "" {
		t.Fatal("expected non-empty hash")
	}

	filesDir := filepath.Join(dir, created.ID, "files")
	files, _ := os.ReadDir(filesDir)
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}

	fileData, _ := os.ReadFile(filepath.Join(filesDir, "test.dat"))
	if !bytes.Equal(fileData, content) {
		t.Fatal("file content mismatch")
	}
}

func TestStore_AddFile_PathTraversalRejected(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan := Plan{Name: "test", SourceType: "geometry", Unit: "m"}
	created, _, err := store.Create(plan)
	if err != nil {
		t.Fatal(err)
	}

	// Path traversal: contains ".." in the filename
	content := []byte("malicious content")
	reader := bytes.NewReader(content)
	// Use a filename that has ".." which will be caught by the contains check
	_, err = store.AddFile(created.ID, "bad..name.dat", reader)
	if err == nil {
		t.Fatal("expected error for filename containing '..'")
	}
}

func TestStore_AddFile_InvalidIDRejected(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	content := []byte("test")
	reader := bytes.NewReader(content)
	_, err = store.AddFile("invalid/id", "test.dat", reader)
	if err == nil {
		t.Fatal("expected error for invalid ID")
	}
}

func TestStore_AddFile_SizeLimitEnforced(t *testing.T) {
	dir := t.TempDir()
	maxSize := int64(1024) // 1 KB limit
	store, err := NewWithLimits(dir, maxSize, maxSize*10, 5)
	if err != nil {
		t.Fatal(err)
	}

	plan := Plan{Name: "test", SourceType: "geometry", Unit: "m"}
	created, _, err := store.Create(plan)
	if err != nil {
		t.Fatal(err)
	}

	largeContent := make([]byte, 2048) // 2 KB exceeds 1 KB limit
	for i := range largeContent {
		largeContent[i] = byte(i % 256)
	}
	reader := bytes.NewReader(largeContent)
	_, err = store.AddFile(created.ID, "large.dat", reader)
	if err == nil {
		t.Fatal("expected size limit error")
	}
}

func TestStore_FinalizePlan(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan := Plan{Name: "test", SourceType: "geometry", Unit: "m"}
	created, _, err := store.Create(plan)
	if err != nil {
		t.Fatal(err)
	}

	content := []byte("test content")
	reader := bytes.NewReader(content)
	file1, err := store.AddFile(created.ID, "file1.dat", reader)
	if err != nil {
		t.Fatal(err)
	}

	reader2 := bytes.NewReader([]byte("more content"))
	file2, err := store.AddFile(created.ID, "file2.dat", reader2)
	if err != nil {
		t.Fatal(err)
	}

	files := []FileInfo{file1, file2}
	totalSize := file1.SizeBytes + file2.SizeBytes
	command := []string{"flow360", "project", "create", "<files>"}

	finalized, err := store.FinalizePlan(created.ID, files, totalSize, command)
	if err != nil {
		t.Fatal(err)
	}

	if len(finalized.Files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(finalized.Files))
	}
	if finalized.SizeBytes != totalSize {
		t.Fatalf("expected total size %d, got %d", totalSize, finalized.SizeBytes)
	}
	if finalized.ContentHash == "" {
		t.Fatal("expected non-empty content hash")
	}
	if len(finalized.Command) != 4 {
		t.Fatalf("expected 4 command parts, got %d", len(finalized.Command))
	}
}

func TestStore_Update_StatusTransitions(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan := Plan{Name: "test", SourceType: "geometry", Unit: "m"}
	created, _, err := store.Create(plan)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Update(created.ID, func(p *Plan) error {
		p.Status = "approved"
		p.UnitConfirmed = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := store.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "approved" {
		t.Fatalf("expected 'approved', got %q", got.Status)
	}
	if !got.UnitConfirmed {
		t.Fatal("expected unit_confirmed to be true")
	}
}

func TestStore_List(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan1 := Plan{Name: "project-1", SourceType: "geometry", Unit: "m", FolderID: "folder-1"}
	_, _, err = store.Create(plan1)
	if err != nil {
		t.Fatal(err)
	}

	plan2 := Plan{Name: "project-2", SourceType: "surface-mesh", Unit: "mm", FolderID: "folder-1"}
	created2, _, err := store.Create(plan2)
	if err != nil {
		t.Fatal(err)
	}

	plan3 := Plan{Name: "project-3", SourceType: "volume-mesh", Unit: "cm", FolderID: "folder-2"}
	_, _, err = store.Create(plan3)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Update(created2.ID, func(p *Plan) error {
		p.Status = "submitted"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	folder1Plans, err := store.List("folder-1", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(folder1Plans) != 2 {
		t.Fatalf("expected 2 plans in folder-1, got %d", len(folder1Plans))
	}

	folder2Plans, err := store.List("folder-2", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(folder2Plans) != 1 {
		t.Fatalf("expected 1 plan in folder-2, got %d", len(folder2Plans))
	}

	submittedPlans, err := store.List("", "submitted")
	if err != nil {
		t.Fatal(err)
	}
	if len(submittedPlans) != 1 {
		t.Fatalf("expected 1 submitted plan, got %d", len(submittedPlans))
	}
}

func TestStore_Abort(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan := Plan{Name: "test", SourceType: "geometry", Unit: "m"}
	created, _, err := store.Create(plan)
	if err != nil {
		t.Fatal(err)
	}

	err = store.Abort(created.ID)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Get(created.ID)
	if err == nil {
		t.Fatal("expected error after abort")
	}
}

func TestStore_Cleanup_RemovesExpiredDrafts(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	oldPlan := Plan{Name: "old-draft", SourceType: "geometry", Unit: "m"}
	created, _, err := store.Create(oldPlan)
	if err != nil {
		t.Fatal(err)
	}

	// Directly write the plan with old UpdatedAt to bypass Update's timestamp reset
	oldPlanData, err := store.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	oldPlanData.UpdatedAt = time.Now().Add(-48 * time.Hour)
	if err := store.write(oldPlanData); err != nil {
		t.Fatal(err)
	}

	newPlan := Plan{Name: "new-draft", SourceType: "geometry", Unit: "m"}
	_, _, err = store.Create(newPlan)
	if err != nil {
		t.Fatal(err)
	}

	cleaned, err := store.Cleanup(24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned != 1 {
		t.Fatalf("expected 1 cleaned plan, got %d", cleaned)
	}

	plans, err := store.List("", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(plans) != 1 {
		t.Fatalf("expected 1 remaining plan, got %d", len(plans))
	}
}

func TestStore_Cleanup_PreservesSubmitted(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan := Plan{Name: "submitted", SourceType: "geometry", Unit: "m"}
	created, _, err := store.Create(plan)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Update(created.ID, func(p *Plan) error {
		p.Status = "submitted"
		p.UpdatedAt = time.Now().Add(-48 * time.Hour)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	cleaned, err := store.Cleanup(24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned != 0 {
		t.Fatalf("expected 0 cleaned, got %d", cleaned)
	}

	plans, err := store.List("", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(plans) != 1 {
		t.Fatalf("expected 1 remaining plan, got %d", len(plans))
	}
}

func TestStore_FindByContentHash(t *testing.T) {
	dir := t.TempDir()
	store, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}

	plan := Plan{Name: "test", SourceType: "geometry", Unit: "m"}
	created, _, err := store.Create(plan)
	if err != nil {
		t.Fatal(err)
	}

	content := []byte("unique content for hash")
	reader := bytes.NewReader(content)
	file, err := store.AddFile(created.ID, "test.dat", reader)
	if err != nil {
		t.Fatal(err)
	}

	files := []FileInfo{file}
	finalized, err := store.FinalizePlan(created.ID, files, file.SizeBytes, []string{"cmd"})
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Update(finalized.ID, func(p *Plan) error {
		p.Status = "submitted"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	found, err := store.FindByContentHash(finalized.ContentHash)
	if err != nil {
		t.Fatal(err)
	}
	if found.ID != finalized.ID {
		t.Fatalf("expected %q, got %q", finalized.ID, found.ID)
	}

	_, err = store.FindByContentHash("non-existent-hash")
	if err == nil {
		t.Fatal("expected error for non-existent hash")
	}
}

func TestStoreStartUsesContentAndOptionsForAtomicDeduplication(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	createReady := func(name, solver string) Plan {
		t.Helper()
		created, _, err := store.Create(Plan{
			Name: name, SourceType: "surface-mesh", Unit: "m", SolverVersion: solver,
		})
		if err != nil {
			t.Fatal(err)
		}
		file, err := store.AddFile(created.ID, "mesh.ugrid", bytes.NewBufferString("same mesh"))
		if err != nil {
			t.Fatal(err)
		}
		finalized, err := store.FinalizePlan(created.ID, []FileInfo{file}, file.SizeBytes, []string{"flow360"})
		if err != nil {
			t.Fatal(err)
		}
		approved, err := store.Update(finalized.ID, func(plan *Plan) error {
			plan.Status = "approved"
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return approved
	}

	first := createReady("baseline", "25.10")
	if _, duplicate, err := store.Start(first.ID); err != nil || duplicate != nil {
		t.Fatalf("first start failed: duplicate=%v err=%v", duplicate, err)
	}

	same := createReady("baseline", "25.10")
	unchanged, duplicate, err := store.Start(same.ID)
	if err != nil || duplicate == nil || duplicate.ID != first.ID {
		t.Fatalf("expected duplicate of %s, got %#v err=%v", first.ID, duplicate, err)
	}
	if unchanged.Status != "approved" {
		t.Fatalf("duplicate plan was left in %q, want approved", unchanged.Status)
	}

	different := createReady("new solver", "26.1")
	started, duplicate, err := store.Start(different.ID)
	if err != nil || duplicate != nil || started.Status != "running" {
		t.Fatalf("different options should run: status=%q duplicate=%v err=%v", started.Status, duplicate, err)
	}
}

func TestComputeContentHash(t *testing.T) {
	files := []FileInfo{
		{Name: "a.dat", Hash: "hash1"},
		{Name: "b.dat", Hash: "hash2"},
	}
	hash := computeContentHash(files)
	if hash == "" {
		t.Fatal("expected non-empty hash")
	}

	// Same order should produce same hash
	hashSame := computeContentHash(files)
	if hash != hashSame {
		t.Fatal("expected same hash for same order")
	}

	// Different order should produce different hash (order-sensitive)
	files2 := []FileInfo{
		{Name: "b.dat", Hash: "hash2"},
		{Name: "a.dat", Hash: "hash1"},
	}
	hash2 := computeContentHash(files2)
	if hash == hash2 {
		t.Fatal("expected different hash for different file order")
	}

	// Different file content should produce different hash
	files3 := []FileInfo{
		{Name: "a.dat", Hash: "hash1"},
		{Name: "b.dat", Hash: "hash3"},
	}
	hash3 := computeContentHash(files3)
	if hash == hash3 {
		t.Fatal("expected different hash for different content")
	}
}

func TestDetectMIME(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		expected string
	}{
		{"empty", []byte{}, "application/octet-stream"},
		{"CGNS", []byte("CGNS"), "application/x-cgns"},
		{"HDF5", []byte("HDF5"), "application/x-hdf5"},
		{"NASTRAN CASE", []byte("$CASE*"), "text/ascii-nastran"},
		{"NASTRAN DATA", []byte("$DATA*"), "text/ascii-nastran"},
		{"VTK", []byte("VTK\x00"), "application/x-vtk"},
		{"STEP", []byte("PF"), "text/x-step"},
		{"binary", []byte{0x00, 0x00, 0x01, 0x02}, "application/binary"},
		{"unknown", []byte("random text content"), "application/octet-stream"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := detectMIME(tt.data)
			if got != tt.expected {
				t.Errorf("detectMIME(%s) = %q, want %q", tt.name, got, tt.expected)
			}
		})
	}
}

func TestValidateID(t *testing.T) {
	store := &Store{dir: "/tmp/test"}

	validID := "import-abc123"
	if err := store.validateID(validID); err != nil {
		t.Errorf("expected valid ID to pass: %v", err)
	}

	invalidIDs := []string{
		"",
		"invalid",
		"import-abc/def",
		"import-abc\\def",
		"import-abc/../etc/passwd",
	}
	for _, id := range invalidIDs {
		if err := store.validateID(id); err == nil {
			t.Errorf("expected error for invalid ID %q", id)
		}
	}
}

func TestValidateFilePath(t *testing.T) {
	store := &Store{dir: "/tmp/test"}

	filesDir := "/tmp/test/import-abc123/files"
	validTarget := "/tmp/test/import-abc123/files/test.dat"
	if err := store.validateFilePath(filesDir, validTarget); err != nil {
		t.Errorf("expected valid path to pass: %v", err)
	}

	invalidTargets := []string{
		"/tmp/test/other-import/files/test.dat",
		"/etc/passwd",
		"/tmp/test/import-abc123/../outside.dat",
	}
	for _, target := range invalidTargets {
		if err := store.validateFilePath(filesDir, target); err == nil {
			t.Errorf("expected error for invalid target %q", target)
		}
	}
}
