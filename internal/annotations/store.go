package annotations

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	SchemaVersion  = 1
	MaxPayloadSize = 1 << 20
)

var (
	ErrNotFound   = errors.New("annotation not found")
	ErrConflict   = errors.New("annotation already exists")
	ErrValidation = errors.New("annotation validation failed")
	ErrCorrupt    = errors.New("stored annotation is corrupt")
)

type ResourceRef struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Version string `json:"version,omitempty"`
}

type CoordinateFrame struct {
	Kind        string       `json:"kind"`
	ResourceRef *ResourceRef `json:"resourceRef,omitempty"`
}

type Snap struct {
	Type       string   `json:"type"`
	Distance   *float64 `json:"distance,omitempty"`
	Confidence *float64 `json:"confidence,omitempty"`
}

type PickResult struct {
	LocalPosition   []float64       `json:"localPosition"`
	WorldPosition   []float64       `json:"worldPosition"`
	ProjectID       string          `json:"projectId"`
	ResourceRef     ResourceRef     `json:"resourceRef"`
	CoordinateFrame CoordinateFrame `json:"coordinateFrame"`
	EntityID        string          `json:"entityId,omitempty"`
	EntityType      string          `json:"entityType,omitempty"`
	TriangleIndex   *int            `json:"triangleIndex,omitempty"`
	VertexIndex     *int            `json:"vertexIndex,omitempty"`
	Normal          []float64       `json:"normal,omitempty"`
	Snap            Snap            `json:"snap"`
}

type Annotation struct {
	SchemaVersion   int                        `json:"schemaVersion"`
	ID              string                     `json:"id"`
	ProjectID       string                     `json:"projectId"`
	ResourceRef     ResourceRef                `json:"resourceRef"`
	CoordinateFrame CoordinateFrame            `json:"coordinateFrame"`
	ToolID          string                     `json:"toolId"`
	Name            string                     `json:"name,omitempty"`
	Points          []PickResult               `json:"points"`
	Result          json.RawMessage            `json:"result"`
	Style           map[string]json.RawMessage `json:"style"`
	Visible         bool                       `json:"visible"`
	CreatedAt       time.Time                  `json:"createdAt"`
	UpdatedAt       time.Time                  `json:"updatedAt"`
}

type CreateInput struct {
	SchemaVersion   int                        `json:"schemaVersion"`
	ResourceRef     ResourceRef                `json:"resourceRef"`
	CoordinateFrame CoordinateFrame            `json:"coordinateFrame"`
	ToolID          string                     `json:"toolId"`
	Name            string                     `json:"name,omitempty"`
	Points          []PickResult               `json:"points"`
	Result          json.RawMessage            `json:"result"`
	Style           map[string]json.RawMessage `json:"style"`
	Visible         *bool                      `json:"visible,omitempty"`
}

type PatchInput struct {
	Name    *string                     `json:"name,omitempty"`
	Style   *map[string]json.RawMessage `json:"style,omitempty"`
	Visible *bool                       `json:"visible,omitempty"`
}

type Store struct {
	root string
	mu   sync.RWMutex
}

func NewStore(root string) (*Store, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, validationError("annotation store directory is required")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create annotation store: %w", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return nil, fmt.Errorf("secure annotation store: %w", err)
	}
	return &Store{root: root}, nil
}

func (s *Store) Create(projectID string, input CreateInput) (Annotation, error) {
	if err := validateID("projectId", projectID); err != nil {
		return Annotation{}, err
	}
	visible := true
	if input.Visible != nil {
		visible = *input.Visible
	}
	now := time.Now().UTC()
	annotation := Annotation{
		SchemaVersion: input.SchemaVersion,
		ProjectID:     projectID, ResourceRef: input.ResourceRef,
		CoordinateFrame: input.CoordinateFrame, ToolID: input.ToolID,
		Name: strings.TrimSpace(input.Name), Points: input.Points,
		Result: cloneRaw(input.Result), Style: cloneStyle(input.Style), Visible: visible,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := validateAnnotation(annotation); err != nil {
		return Annotation{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	projectDir, err := s.ensureProjectDir(projectID)
	if err != nil {
		return Annotation{}, err
	}
	for attempts := 0; attempts < 4; attempts++ {
		annotation.ID, err = newID()
		if err != nil {
			return Annotation{}, err
		}
		target := filepath.Join(projectDir, annotation.ID+".json")
		if _, statErr := os.Stat(target); statErr == nil {
			continue
		} else if !os.IsNotExist(statErr) {
			return Annotation{}, statErr
		}
		if err := writeAtomic(projectDir, target, annotation); err != nil {
			return Annotation{}, err
		}
		return cloneAnnotation(annotation), nil
	}
	return Annotation{}, ErrConflict
}

func (s *Store) List(projectID string) ([]Annotation, error) {
	if err := validateID("projectId", projectID); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	projectDir := s.projectDir(projectID)
	entries, err := os.ReadDir(projectDir)
	if os.IsNotExist(err) {
		return []Annotation{}, nil
	}
	if err != nil {
		return nil, err
	}
	result := make([]Annotation, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		annotation, err := s.read(projectID, id)
		if err != nil {
			return nil, fmt.Errorf("read annotation %s: %w", id, err)
		}
		result = append(result, annotation)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].ID < result[j].ID
		}
		return result[i].CreatedAt.Before(result[j].CreatedAt)
	})
	return result, nil
}

func (s *Store) Get(projectID, annotationID string) (Annotation, error) {
	if err := validateIDs(projectID, annotationID); err != nil {
		return Annotation{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.read(projectID, annotationID)
}

func (s *Store) Patch(projectID, annotationID string, input PatchInput) (Annotation, error) {
	if err := validateIDs(projectID, annotationID); err != nil {
		return Annotation{}, err
	}
	if input.Name == nil && input.Style == nil && input.Visible == nil {
		return Annotation{}, validationError("patch must contain at least one supported field")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	annotation, err := s.read(projectID, annotationID)
	if err != nil {
		return Annotation{}, err
	}
	if input.Name != nil {
		annotation.Name = strings.TrimSpace(*input.Name)
	}
	if input.Style != nil {
		annotation.Style = cloneStyle(*input.Style)
	}
	if input.Visible != nil {
		annotation.Visible = *input.Visible
	}
	annotation.UpdatedAt = time.Now().UTC()
	if err := validateAnnotation(annotation); err != nil {
		return Annotation{}, err
	}
	projectDir := s.projectDir(projectID)
	if err := writeAtomic(projectDir, filepath.Join(projectDir, annotationID+".json"), annotation); err != nil {
		return Annotation{}, err
	}
	return cloneAnnotation(annotation), nil
}

func (s *Store) Delete(projectID, annotationID string) error {
	if err := validateIDs(projectID, annotationID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	target := filepath.Join(s.projectDir(projectID), annotationID+".json")
	if err := os.Remove(target); os.IsNotExist(err) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	return nil
}

func (s *Store) projectDir(projectID string) string {
	return filepath.Join(s.root, projectID)
}

func (s *Store) ensureProjectDir(projectID string) (string, error) {
	dir := s.projectDir(projectID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

func (s *Store) read(projectID, annotationID string) (Annotation, error) {
	payload, err := os.ReadFile(filepath.Join(s.projectDir(projectID), annotationID+".json"))
	if os.IsNotExist(err) {
		return Annotation{}, ErrNotFound
	}
	if err != nil {
		return Annotation{}, err
	}
	if len(payload) > MaxPayloadSize {
		return Annotation{}, fmt.Errorf("%w: payload exceeds 1 MiB", ErrCorrupt)
	}
	var annotation Annotation
	if err := json.Unmarshal(payload, &annotation); err != nil {
		return Annotation{}, fmt.Errorf("%w: decode JSON: %v", ErrCorrupt, err)
	}
	if annotation.ID != annotationID || annotation.ProjectID != projectID {
		return Annotation{}, fmt.Errorf("%w: identity mismatch", ErrCorrupt)
	}
	if err := validateAnnotation(annotation); err != nil {
		return Annotation{}, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	return cloneAnnotation(annotation), nil
}

func writeAtomic(dir, target string, annotation Annotation) error {
	payload, err := json.MarshalIndent(annotation, "", "  ")
	if err != nil {
		return err
	}
	if len(payload) > MaxPayloadSize {
		return validationError("annotation exceeds 1 MiB")
	}
	temp, err := os.CreateTemp(dir, ".annotation-*.tmp")
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
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempName, target); err != nil {
		return err
	}
	return os.Chmod(target, 0o600)
}

func validateIDs(projectID, annotationID string) error {
	if err := validateID("projectId", projectID); err != nil {
		return err
	}
	return validateID("annotationId", annotationID)
}

func validateID(name, value string) error {
	if value == "" || len(value) > 160 || value == "." || value == ".." {
		return validationError(name + " is invalid")
	}
	for _, r := range value {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.') {
			return validationError(name + " is invalid")
		}
	}
	return nil
}

func validateAnnotation(annotation Annotation) error {
	if annotation.SchemaVersion != SchemaVersion {
		return validationError(fmt.Sprintf("unsupported schemaVersion: %d", annotation.SchemaVersion))
	}
	if annotation.ID != "" {
		if err := validateID("annotation id", annotation.ID); err != nil {
			return err
		}
	}
	if err := validateID("projectId", annotation.ProjectID); err != nil {
		return err
	}
	if err := validateResourceRef(annotation.ResourceRef); err != nil {
		return err
	}
	if err := validateCoordinateFrame(annotation.CoordinateFrame); err != nil {
		return err
	}
	if annotation.CoordinateFrame.ResourceRef != nil &&
		!sameResourceRef(annotation.ResourceRef, *annotation.CoordinateFrame.ResourceRef) {
		return validationError("coordinateFrame.resourceRef does not match annotation resourceRef")
	}
	if annotation.ToolID == "" || len(annotation.ToolID) > 120 || !utf8.ValidString(annotation.ToolID) {
		return validationError("toolId is invalid")
	}
	if len(annotation.Name) > 240 || !utf8.ValidString(annotation.Name) {
		return validationError("name is invalid")
	}
	if annotation.Points == nil || len(annotation.Points) > 10000 {
		return validationError("points must be an array of at most 10000 picks")
	}
	for i, point := range annotation.Points {
		if point.ProjectID != annotation.ProjectID {
			return validationError(fmt.Sprintf("points[%d].projectId does not match project", i))
		}
		if !sameResourceRef(point.ResourceRef, annotation.ResourceRef) {
			return validationError(fmt.Sprintf("points[%d].resourceRef does not match annotation", i))
		}
		if err := validatePick(point); err != nil {
			return validationError(fmt.Sprintf("points[%d]: %v", i, err))
		}
	}
	if err := validateRawJSON("result", annotation.Result, false); err != nil {
		return err
	}
	if annotation.Style == nil {
		return validationError("style is required")
	}
	for key, value := range annotation.Style {
		if key == "" || len(key) > 120 || !utf8.ValidString(key) {
			return validationError("style contains an invalid key")
		}
		if err := validateRawJSON("style."+key, value, true); err != nil {
			return err
		}
	}
	if !annotation.CreatedAt.IsZero() && annotation.UpdatedAt.Before(annotation.CreatedAt) {
		return validationError("updatedAt precedes createdAt")
	}
	return nil
}

func validatePick(point PickResult) error {
	if err := validateVector("localPosition", point.LocalPosition, true); err != nil {
		return err
	}
	if err := validateVector("worldPosition", point.WorldPosition, true); err != nil {
		return err
	}
	if err := validateResourceRef(point.ResourceRef); err != nil {
		return err
	}
	if err := validateCoordinateFrame(point.CoordinateFrame); err != nil {
		return err
	}
	if point.CoordinateFrame.ResourceRef != nil &&
		!sameResourceRef(point.ResourceRef, *point.CoordinateFrame.ResourceRef) {
		return validationError("coordinateFrame.resourceRef does not match pick resourceRef")
	}
	if err := validateVector("normal", point.Normal, false); err != nil {
		return err
	}
	if point.TriangleIndex != nil && *point.TriangleIndex < 0 {
		return validationError("triangleIndex must be non-negative")
	}
	if point.VertexIndex != nil && *point.VertexIndex < 0 {
		return validationError("vertexIndex must be non-negative")
	}
	if point.Snap.Type == "" {
		return validationError("snap.type is required")
	}
	if point.Snap.Distance != nil && !finite(*point.Snap.Distance) {
		return validationError("snap.distance must be finite")
	}
	if point.Snap.Confidence != nil && !finite(*point.Snap.Confidence) {
		return validationError("snap.confidence must be finite")
	}
	return nil
}

func sameResourceRef(left, right ResourceRef) bool {
	return left.ID == right.ID && left.Type == right.Type && left.Version == right.Version
}

func validateResourceRef(ref ResourceRef) error {
	if err := validateID("resourceRef.id", ref.ID); err != nil {
		return err
	}
	if ref.Type == "" || len(ref.Type) > 80 || !utf8.ValidString(ref.Type) {
		return validationError("resourceRef.type is invalid")
	}
	if len(ref.Version) > 120 || !utf8.ValidString(ref.Version) {
		return validationError("resourceRef.version is invalid")
	}
	return nil
}

func validateCoordinateFrame(frame CoordinateFrame) error {
	switch frame.Kind {
	case "world":
		if frame.ResourceRef != nil {
			return validationError("world coordinate frame cannot include resourceRef")
		}
	case "asset-local":
		if frame.ResourceRef == nil {
			return validationError("asset-local coordinate frame requires resourceRef")
		}
		return validateResourceRef(*frame.ResourceRef)
	default:
		return validationError("coordinateFrame.kind is invalid")
	}
	return nil
}

func validateVector(name string, values []float64, required bool) error {
	if !required && len(values) == 0 {
		return nil
	}
	if len(values) != 3 {
		return validationError(name + " must contain exactly 3 values")
	}
	for _, value := range values {
		if !finite(value) {
			return validationError(name + " must contain only finite values")
		}
	}
	return nil
}

func validateRawJSON(name string, value json.RawMessage, allowNull bool) error {
	if len(value) == 0 || !json.Valid(value) {
		return validationError(name + " must be valid JSON")
	}
	if !allowNull && string(value) == "null" {
		return validationError(name + " is required")
	}
	decoder := json.NewDecoder(strings.NewReader(string(value)))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return validationError(name + " must be valid JSON")
	}
	if !jsonNumbersFinite(decoded) {
		return validationError(name + " must contain only finite numbers")
	}
	return nil
}

func jsonNumbersFinite(value any) bool {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Float64()
		return err == nil && finite(parsed)
	case []any:
		for _, item := range typed {
			if !jsonNumbersFinite(item) {
				return false
			}
		}
	case map[string]any:
		for _, item := range typed {
			if !jsonNumbersFinite(item) {
				return false
			}
		}
	}
	return true
}

func validationError(message string) error {
	return fmt.Errorf("%w: %s", ErrValidation, message)
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func newID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate annotation id: %w", err)
	}
	return "ann-" + hex.EncodeToString(bytes[:]), nil
}

func cloneRaw(value json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), value...)
}

func cloneStyle(style map[string]json.RawMessage) map[string]json.RawMessage {
	if style == nil {
		return nil
	}
	cloned := make(map[string]json.RawMessage, len(style))
	for key, value := range style {
		cloned[key] = cloneRaw(value)
	}
	return cloned
}

func cloneAnnotation(annotation Annotation) Annotation {
	annotation.Result = cloneRaw(annotation.Result)
	annotation.Style = cloneStyle(annotation.Style)
	annotation.Points = append([]PickResult(nil), annotation.Points...)
	for index := range annotation.Points {
		annotation.Points[index].LocalPosition = append([]float64(nil), annotation.Points[index].LocalPosition...)
		annotation.Points[index].WorldPosition = append([]float64(nil), annotation.Points[index].WorldPosition...)
		annotation.Points[index].Normal = append([]float64(nil), annotation.Points[index].Normal...)
	}
	return annotation
}
