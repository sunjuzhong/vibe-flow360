package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	maxResultInterpretationBody    = 256 << 10
	maxResultInterpretationColumns = 40
)

type resultColumnSummary struct {
	Field        string   `json:"field"`
	Kind         string   `json:"kind"`
	Count        int      `json:"count"`
	Missing      int      `json:"missing"`
	Unique       int      `json:"unique"`
	Minimum      *float64 `json:"minimum,omitempty"`
	Maximum      *float64 `json:"maximum,omitempty"`
	Mean         *float64 `json:"mean,omitempty"`
	First        string   `json:"first,omitempty"`
	Last         string   `json:"last,omitempty"`
	SampleValues []string `json:"sample_values,omitempty"`
}

type resultInterpretationRequest struct {
	Path       string                `json:"path"`
	Language   string                `json:"language"`
	TotalRows  int                   `json:"total_rows"`
	Delimiter  string                `json:"delimiter"`
	Columns    []resultColumnSummary `json:"columns"`
	SampleRows []map[string]string   `json:"sample_rows,omitempty"`
}

func (s *Server) interpretResult(c *gin.Context) {
	if s.agent == nil || !s.agent.SupportsGeneration() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI interpretation requires a configured model provider"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxResultInterpretationBody)
	var request resultInterpretationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid result interpretation request"})
		return
	}
	if err := validateResultInterpretation(request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	payload, err := json.Marshal(request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not prepare result summary"})
		return
	}
	language := "English"
	if strings.EqualFold(request.Language, "zh-CN") || strings.HasPrefix(strings.ToLower(request.Language), "zh") {
		language = "Simplified Chinese"
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 75*time.Second)
	defer cancel()
	interpretation, err := s.agent.Complete(ctx,
		"You are a careful CFD data analyst. Interpret only the supplied statistical summary and representative rows. Do not claim that a simulation converged solely because a run completed. Distinguish observations from hypotheses, call out missing context, and never invent units or thresholds. Return concise Markdown with sections for overview, important patterns, risks or anomalies, and recommended next checks.",
		fmt.Sprintf("Interpret this CSV result in %s. The statistics were computed over every parsed row; sample_rows are representative context only.\n\n%s", language, payload),
		"",
	)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "AI interpretation timed out"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI interpretation is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"interpretation": strings.TrimSpace(interpretation)})
}

func validateResultInterpretation(request resultInterpretationRequest) error {
	if strings.TrimSpace(request.Path) == "" || len(request.Path) > 512 {
		return errors.New("result path is required")
	}
	if request.TotalRows < 0 || request.TotalRows > 5_000_000 {
		return errors.New("invalid result row count")
	}
	if len(request.Columns) == 0 || len(request.Columns) > maxResultInterpretationColumns {
		return errors.New("result summary must contain between 1 and 40 columns")
	}
	if len(request.SampleRows) > 32 {
		return errors.New("result summary contains too many sample rows")
	}
	for _, column := range request.Columns {
		if strings.TrimSpace(column.Field) == "" || len(column.Field) > 160 || (column.Kind != "numeric" && column.Kind != "text") {
			return errors.New("result summary contains an invalid column")
		}
		if column.Count < 0 || column.Missing < 0 || column.Unique < 0 {
			return errors.New("result summary contains invalid column counts")
		}
	}
	return nil
}
