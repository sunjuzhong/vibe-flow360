package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/annotations"
)

const maxAnnotationRequestBytes = annotations.MaxPayloadSize

// AnnotationHandlers is independent from Server so the annotation API can be
// registered without exposing its store to unrelated handlers.
type AnnotationHandlers struct {
	store *annotations.Store
}

func NewAnnotationHandlers(store *annotations.Store) *AnnotationHandlers {
	return &AnnotationHandlers{store: store}
}

func (h *AnnotationHandlers) RegisterRoutes(routes gin.IRoutes) {
	routes.GET("/projects/:project_id/annotations", h.list)
	routes.POST("/projects/:project_id/annotations", h.create)
	routes.GET("/projects/:project_id/annotations/:annotation_id", h.get)
	routes.PATCH("/projects/:project_id/annotations/:annotation_id", h.patch)
	routes.DELETE("/projects/:project_id/annotations/:annotation_id", h.delete)
}

func (h *AnnotationHandlers) list(c *gin.Context) {
	items, err := h.store.List(c.Param("project_id"))
	if err != nil {
		writeAnnotationError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"annotations": items})
}

func (h *AnnotationHandlers) create(c *gin.Context) {
	var input annotations.CreateInput
	if err := decodeAnnotationJSON(c, &input); err != nil {
		writeAnnotationError(c, err)
		return
	}
	created, err := h.store.Create(c.Param("project_id"), input)
	if err != nil {
		writeAnnotationError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

func (h *AnnotationHandlers) get(c *gin.Context) {
	annotation, err := h.store.Get(c.Param("project_id"), c.Param("annotation_id"))
	if err != nil {
		writeAnnotationError(c, err)
		return
	}
	c.JSON(http.StatusOK, annotation)
}

func (h *AnnotationHandlers) patch(c *gin.Context) {
	var input annotations.PatchInput
	if err := decodeAnnotationJSON(c, &input); err != nil {
		writeAnnotationError(c, err)
		return
	}
	updated, err := h.store.Patch(c.Param("project_id"), c.Param("annotation_id"), input)
	if err != nil {
		writeAnnotationError(c, err)
		return
	}
	c.JSON(http.StatusOK, updated)
}

func (h *AnnotationHandlers) delete(c *gin.Context) {
	if err := h.store.Delete(c.Param("project_id"), c.Param("annotation_id")); err != nil {
		writeAnnotationError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func decodeAnnotationJSON(c *gin.Context, destination any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAnnotationRequestBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			return fmt.Errorf("%w: request exceeds 1 MiB", annotations.ErrValidation)
		}
		return fmt.Errorf("%w: invalid JSON request: %v", annotations.ErrValidation, err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%w: request must contain exactly one JSON object", annotations.ErrValidation)
	}
	return nil
}

func writeAnnotationError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	code := "internal_error"
	switch {
	case errors.Is(err, annotations.ErrNotFound):
		status, code = http.StatusNotFound, "not_found"
	case errors.Is(err, annotations.ErrConflict):
		status, code = http.StatusConflict, "conflict"
	case errors.Is(err, annotations.ErrValidation):
		status, code = http.StatusBadRequest, "validation_error"
	case errors.Is(err, annotations.ErrCorrupt):
		status, code = http.StatusInternalServerError, "corrupt_data"
	}
	message := strings.TrimSpace(err.Error())
	if status == http.StatusInternalServerError && code == "internal_error" {
		message = "annotation operation failed"
	}
	c.JSON(status, gin.H{"error": message, "code": code})
}
