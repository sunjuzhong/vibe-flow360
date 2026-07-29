package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/sjzsdu/vibesim/internal/plans"
)

// Engine orchestrates the intervention lifecycle
type Engine struct {
	store *InterventionStore
	plans *plans.Store
	ai    *Service
}

// NewEngine creates a new intervention engine
func NewEngine(store *InterventionStore, planStore *plans.Store, aiService *Service) *Engine {
	return &Engine{
		store: store,
		plans: planStore,
		ai:    aiService,
	}
}

// CreateFromPreflightError creates an intervention from preflight errors
func (e *Engine) CreateFromPreflightError(plan plans.Plan) (Intervention, error) {
	if plan.Preflight == nil || plan.Preflight.Valid {
		return Intervention{}, fmt.Errorf("no preflight errors to create intervention from")
	}

	var evidence []Evidence
	for _, issue := range plan.Preflight.Issues {
		content := map[string]interface{}{
			"code":    issue.Code,
			"level":   issue.Level,
			"path":    issue.Path,
			"message": issue.Message,
			"stages":  issue.Stages,
		}
		contentJSON, _ := json.Marshal(content)
		evidence = append(evidence, Evidence{
			Type:      "preflight_issue",
			Content:   contentJSON,
			Source:    "flow360_preflight",
			Timestamp: time.Now().UTC(),
		})
	}

	input := InterventionInput{
		ProjectID:    plan.ProjectID,
		ProjectName:  plan.ProjectName,
		ResourceID:   plan.SourceID,
		ResourceType: plan.SourceType,
		PlanID:       plan.ID,
		Type:         TypePreflightError,
		Reason:       extractPreflightReason(plan.Preflight.Issues),
		Evidence:     evidence,
		CurrentPatch: plan.Patch,
	}

	intervention, err := NewIntervention(input)
	if err != nil {
		return Intervention{}, err
	}
	return e.store.Create(intervention)
}

// CreateFromRunError creates an intervention from execution errors
func (e *Engine) CreateFromRunError(plan plans.Plan, runErr error) (Intervention, error) {
	errCategory := classifyRunError(runErr)

	evidence := []Evidence{{
		Type:      "execution_error",
		Content:   json.RawMessage(fmt.Sprintf(`{"error":"%s","category":"%s"}`, runErr.Error(), errCategory)),
		Source:    "flow360_execution",
		Timestamp: time.Now().UTC(),
	}}

	input := InterventionInput{
		ProjectID:    plan.ProjectID,
		ProjectName:  plan.ProjectName,
		ResourceID:   plan.SourceID,
		ResourceType: plan.SourceType,
		PlanID:       plan.ID,
		Type:         mapErrorCategoryToType(errCategory),
		Reason:       runErr.Error(),
		Evidence:     evidence,
		CurrentPatch: plan.Patch,
	}

	intervention, err := NewIntervention(input)
	if err != nil {
		return Intervention{}, err
	}
	return e.store.Create(intervention)
}

// RunEngineStep executes the next step in the intervention lifecycle
func (e *Engine) RunEngineStep(interventionID string) (Intervention, error) {
	intervention, err := e.store.Get(interventionID)
	if err != nil {
		return Intervention{}, err
	}

	switch intervention.State {
	case InterventionObservation:
		return e.runDiagnosis(intervention)
	case InterventionDiagnosis:
		return e.generateProposals(intervention)
	case InterventionProposal:
		return intervention, nil
	case InterventionUserFeedback:
		return e.compilePatch(intervention)
	case InterventionPatchCompile:
		return e.validate(intervention)
	case InterventionValidation:
		return intervention, nil
	default:
		return intervention, nil
	}
}

// runDiagnosis performs automated diagnosis
func (e *Engine) runDiagnosis(intervention Intervention) (Intervention, error) {
	diagnosis := Diagnosis{
		RootCause:           determineRootCause(intervention),
		Category:            mapInterventionTypeToCategory(intervention.Type),
		Severity:            determineSeverity(intervention),
		ContributingFactors: extractContributingFactors(intervention),
		RecommendedActions:  generateRecommendedActions(intervention),
	}

	return e.store.Update(intervention.ID, func(i *Intervention) error {
		return i.RunDiagnosis(diagnosis)
	})
}

// generateProposals creates AI-based fix proposals
func (e *Engine) generateProposals(intervention Intervention) (Intervention, error) {
	proposals := e.buildProposalsWithAI(intervention)

	return e.store.Update(intervention.ID, func(i *Intervention) error {
		return i.GenerateProposals(proposals)
	})
}

// compilePatch compiles the selected proposal into a patch, merging user feedback
func (e *Engine) compilePatch(intervention Intervention) (Intervention, error) {
	if intervention.SelectedProposal == nil {
		return intervention, fmt.Errorf("no proposal selected")
	}

	compiled := intervention.SelectedProposal.Patch
	if len(compiled) == 0 {
		compiled = json.RawMessage(`{}`)
	}

	if intervention.UserFeedback != "" {
		compiled = mergeFeedbackIntoPatch(compiled, intervention.UserFeedback)
	}

	return e.store.Update(intervention.ID, func(i *Intervention) error {
		return i.CompilePatch(compiled)
	})
}

// validate triggers validation
func (e *Engine) validate(intervention Intervention) (Intervention, error) {
	return e.store.Update(intervention.ID, func(i *Intervention) error {
		return i.Validate()
	})
}

// SelectProposalAndAdvance selects a proposal and advances the state
func (e *Engine) SelectProposalAndAdvance(interventionID string, proposalID string, feedback string) (Intervention, error) {
	intervention, err := e.store.Get(interventionID)
	if err != nil {
		return Intervention{}, err
	}

	var selected *Proposal
	for _, p := range intervention.Proposals {
		if p.ID == proposalID {
			p := p
			selected = &p
			break
		}
	}
	if selected == nil {
		return Intervention{}, fmt.Errorf("proposal not found: %s", proposalID)
	}

	if _, err := e.store.Update(interventionID, func(i *Intervention) error {
		return i.SelectProposal(*selected, feedback)
	}); err != nil {
		return Intervention{}, err
	}

	return e.RunEngineStep(interventionID)
}

// CompleteValidation completes the validation step
func (e *Engine) CompleteValidation(interventionID string, valid bool, errors []string) (Intervention, error) {
	validation := ValidationResult{
		Valid:       valid,
		Errors:      errors,
		PreflightID: "pf-" + interventionID,
	}

	if valid {
		return e.store.Update(interventionID, func(i *Intervention) error {
			return i.Resolve(validation)
		})
	}

	return e.store.Update(interventionID, func(i *Intervention) error {
		return i.Fail(strings.Join(errors, "; "))
	})
}

// RetryFromFailed resets a failed intervention back to observation state for retry
func (e *Engine) RetryFromFailed(interventionID string) (Intervention, error) {
	intervention, err := e.store.Get(interventionID)
	if err != nil {
		return Intervention{}, err
	}

	if intervention.State != InterventionFailed && intervention.State != InterventionValidation {
		return Intervention{}, fmt.Errorf("can only retry failed or invalid interventions")
	}

	return e.store.Update(interventionID, func(i *Intervention) error {
		i.State = InterventionObservation
		i.UpdatedAt = time.Now().UTC()
		i.Validation = nil
		i.SelectedProposal = nil
		i.Proposals = nil
		i.CompiledPatch = nil
		i.UserFeedback = ""
		return nil
	})
}

// Get retrieves an intervention
func (e *Engine) Get(id string) (Intervention, error) {
	return e.store.Get(id)
}

// List returns interventions with filters
func (e *Engine) List(projectID, resourceID, state string) ([]Intervention, error) {
	return e.store.List(projectID, resourceID, state)
}

// ListActive returns active interventions
func (e *Engine) ListActive() ([]Intervention, error) {
	return e.store.ListActive()
}

// Close closes an intervention
func (e *Engine) Close(id string) (Intervention, error) {
	return e.store.Update(id, func(i *Intervention) error {
		return i.Close()
	})
}

// buildProposalsWithAI generates fix proposals using the AI service when available
func (e *Engine) buildProposalsWithAI(intervention Intervention) []Proposal {
	if e.ai != nil && strings.TrimSpace(e.ai.APIKey) != "" {
		proposals := e.buildProposalsFromAI(intervention)
		if len(proposals) > 0 {
			return proposals
		}
	}
	return e.buildProposals(intervention)
}

// buildProposalsFromAI calls the AI service to generate proposals
func (e *Engine) buildProposalsFromAI(intervention Intervention) []Proposal {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	evidenceSummary := summarizeEvidence(intervention.Evidence)
	prompt := fmt.Sprintf(`You are a Flow360 simulation recovery agent. Analyze this error and provide structured fix proposals.

Error type: %s
Reason: %s
Evidence: %s
Diagnosis: %s

For each proposal, provide:
- A descriptive name
- The target resource type
- Specific parameter changes as valid JSON
- Confidence level (high/medium/low)

Respond with a JSON array of proposals.`,
		intervention.Type,
		intervention.Reason,
		evidenceSummary,
		formatDiagnosisForPrompt(intervention.Diagnosis),
	)

	chatReq := ChatRequest{
		Message: prompt,
		Context: fmt.Sprintf("project:%s resource:%s plan:%s",
			intervention.ProjectID, intervention.ResourceID, intervention.PlanID),
	}

	response, err := e.ai.Chat(ctx, chatReq)
	if err != nil || strings.TrimSpace(response) == "" {
		return nil
	}

	proposals := parseAIProposals(response, intervention)
	if len(proposals) == 0 {
		return nil
	}
	return proposals
}

func summarizeEvidence(evidence []Evidence) string {
	var parts []string
	for _, e := range evidence {
		var data map[string]interface{}
		if err := json.Unmarshal(e.Content, &data); err == nil {
			if msg, ok := data["message"].(string); ok {
				parts = append(parts, msg)
			}
		}
	}
	if len(parts) == 0 {
		return "No detailed evidence available"
	}
	return strings.Join(parts, "; ")
}

func formatDiagnosisForPrompt(d *Diagnosis) string {
	if d == nil {
		return "Not yet diagnosed"
	}
	return fmt.Sprintf("%s (%s, severity: %s)", d.RootCause, d.Category, d.Severity)
}

func parseAIProposals(response string, intervention Intervention) []Proposal {
	jsonStart := strings.Index(response, "[")
	jsonEnd := strings.LastIndex(response, "]")
	if jsonStart < 0 || jsonEnd < 0 {
		return nil
	}
	jsonStr := response[jsonStart : jsonEnd+1]

	type aiProposal struct {
		Name       string          `json:"name"`
		Target     string          `json:"target"`
		Patch      json.RawMessage `json:"patch"`
		Reason     string          `json:"reason"`
		Confidence string          `json:"confidence"`
	}

	var aiProposals []aiProposal
	if err := json.Unmarshal([]byte(jsonStr), &aiProposals); err != nil {
		return nil
	}

	var proposals []Proposal
	for i, ap := range aiProposals {
		target := ap.Target
		if target == "" {
			target = "case"
		}
		intent := ap.Reason
		if intent == "" {
			intent = "AI-generated fix proposal"
		}
		patch := ap.Patch
		if len(patch) == 0 {
			patch = json.RawMessage(`{}`)
		}

		proposal := Proposal{
			ID:            fmt.Sprintf("ai-proposal-%d", i+1),
			Target:        target,
			Name:          ap.Name,
			Intent:        intent,
			Patch:         patch,
			BranchPreview: fmt.Sprintf("ai-fix-%s-%d", intervention.Type, i+1),
			Fields: []Field{
				{Key: "ai_generated", Value: true, Provenance: ProvenanceInferred, Description: "Generated by AI analysis"},
				{Key: "confidence", Value: confidenceFromString(ap.Confidence), Provenance: ProvenanceInferred, Description: "AI confidence level"},
			},
			ValidationHints: []string{"Review and validate before applying"},
		}
		proposals = append(proposals, proposal)
	}
	return proposals
}

func confidenceFromString(level string) float64 {
	switch strings.ToLower(level) {
	case "high":
		return 0.85
	case "medium":
		return 0.65
	case "low":
		return 0.45
	default:
		return 0.5
	}
}

// mergeFeedbackIntoPatch merges user feedback into the proposal patch
func mergeFeedbackIntoPatch(patch json.RawMessage, feedback string) json.RawMessage {
	var base map[string]interface{}
	if len(patch) > 0 {
		if err := json.Unmarshal(patch, &base); err != nil {
			base = map[string]interface{}{}
		}
	} else {
		base = map[string]interface{}{}
	}

	feedbackLower := strings.ToLower(feedback)
	adjustments := map[string]interface{}{
		"_feedback_note":    feedback,
		"_feedback_applied": true,
	}

	adjusted := false

	if strings.Contains(feedbackLower, "more conservative") || strings.Contains(feedbackLower, "reduce") {
		if cfl, ok := base["cfl_number"].(float64); ok {
			base["cfl_number"] = cfl * 0.8
			adjustments["cfl_number_adjusted"] = true
			adjusted = true
		}
		if relax, ok := base["relaxation_factor"].(float64); ok {
			base["relaxation_factor"] = relax * 0.9
			adjustments["relaxation_adjusted"] = true
			adjusted = true
		}
		if !adjusted {
			base["cfl_number"] = 5.0
			base["relaxation_factor"] = 0.7
			adjusted = true
		}
	}

	if strings.Contains(feedbackLower, "more aggressive") || strings.Contains(feedbackLower, "increase") {
		if cfl, ok := base["cfl_number"].(float64); ok {
			base["cfl_number"] = cfl * 1.2
			adjustments["cfl_number_adjusted"] = true
			adjusted = true
		} else {
			base["cfl_number"] = 20.0
			adjusted = true
		}
	}

	if strings.Contains(feedbackLower, "simplify") || strings.Contains(feedbackLower, "basic") {
		base["turbulence_model"] = "spalart_allmaras"
		adjustments["turbulence_simplified"] = true
		adjusted = true
	}

	if strings.Contains(feedbackLower, "k-omega") || strings.Contains(feedbackLower, "komega") {
		base["turbulence_model"] = "k_omega_sst"
		adjustments["turbulence_model_set"] = "k_omega_sst"
		adjusted = true
	}

	if strings.Contains(feedbackLower, "k-epsilon") || strings.Contains(feedbackLower, "kepsilon") {
		base["turbulence_model"] = "k_epsilon"
		adjustments["turbulence_model_set"] = "k_epsilon"
		adjusted = true
	}

	if strings.Contains(feedbackLower, "transient") || strings.Contains(feedbackLower, "unsteady") {
		base["time_stepping"] = map[string]interface{}{
			"scheme":    "implicit",
			"time_step": 0.001,
			"max_steps": 50000,
		}
		adjusted = true
	}

	if strings.Contains(feedbackLower, "steady") || strings.Contains(feedbackLower, "stable") {
		base["time_stepping"] = map[string]interface{}{
			"scheme":    "steady",
			"max_steps": 10000,
		}
		adjusted = true
	}

	if !adjusted && len(patch) > 0 {
		adjustments["_feedback_processed"] = false
		adjustments["_feedback_hint"] = "Consider providing specific parameters to adjust (e.g., 'more conservative', 'simplify model', 'k-omega')"
	}

	for k, v := range adjustments {
		base[k] = v
	}

	result, err := json.Marshal(base)
	if err != nil {
		return patch
	}
	return result
}

// buildProposals generates fix proposals based on the intervention type and evidence
func (e *Engine) buildProposals(intervention Intervention) []Proposal {
	var proposals []Proposal

	switch intervention.Type {
	case TypePreflightError:
		proposals = buildPreflightProposals(intervention)
	case TypeMeshFailure:
		proposals = buildMeshProposals(intervention)
	case TypeSolverFailure:
		proposals = buildSolverProposals(intervention)
	case TypeConvergenceAnomaly:
		proposals = buildConvergenceProposals(intervention)
	case TypeRemoteError:
		proposals = buildRemoteProposals(intervention)
	default:
		proposals = buildGenericProposals(intervention)
	}

	return proposals
}

func buildPreflightProposals(intervention Intervention) []Proposal {
	evidenceIDs := extractEvidenceResourceIDs(intervention.Evidence)
	entityList := evidenceIDs
	if len(entityList) == 0 {
		entityList = []string{"inlet", "outlet", "walls", "symmetry"}
	}

	proposals := []Proposal{
		{
			ID:            "pf-recommend-1",
			Target:        "case",
			Name:          "Apply AI-recommended boundary conditions",
			Intent:        "Use AI-inferred boundary conditions to resolve preflight errors",
			Patch:         json.RawMessage(fmt.Sprintf(`{"entity_assignment": {"model": "Wall", "entities": %s}}`, mustJSON(entityList))),
			BranchPreview: "recommended-boundary-conditions",
			Fields: []Field{
				{Key: "boundary_model", Value: "Wall", Provenance: ProvenanceInferred, Description: "Inferred from existing model intent"},
				{Key: "entities", Value: fmt.Sprintf("%d faces", len(entityList)), Provenance: ProvenanceInferred, Description: "Selected based on geometry analysis"},
			},
			ValidationHints: []string{"Review boundary condition assignments before running"},
		},
		{
			ID:            "pf-recommend-2",
			Target:        "case",
			Name:          "Reset to default boundary setup",
			Intent:        "Reset entity assignments to Flow360 defaults for clean configuration",
			Patch:         json.RawMessage(`{"entity_assignment": {"model": "Freestream", "entities": []}}`),
			BranchPreview: "default-boundary-setup",
			Fields: []Field{
				{Key: "boundary_model", Value: "Freestream", Provenance: ProvenanceDefaulted, Description: "Flow360 default"},
			},
			ValidationHints: []string{"This will clear current boundary assignments"},
		},
	}
	return proposals
}

func mustJSON(items []string) string {
	data, err := json.Marshal(items)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func extractEvidenceResourceIDs(evidence []Evidence) []string {
	var ids []string
	for _, e := range evidence {
		var data map[string]interface{}
		if err := json.Unmarshal(e.Content, &data); err != nil {
			continue
		}
		if path, ok := data["path"].(string); ok && path != "" {
			ids = append(ids, path)
		}
	}
	return ids
}

func buildMeshProposals(intervention Intervention) []Proposal {
	return []Proposal{
		{
			ID:            "mesh-fix-1",
			Target:        "volume-mesh",
			Name:          "Refine mesh quality parameters",
			Intent:        "Adjust mesh generation parameters to improve quality",
			Patch:         json.RawMessage(`{"mesh": {"quality": {"max_skewness": 0.85, "min_orthogonality": 35}}}`),
			BranchPreview: "refined-mesh-quality",
			Fields: []Field{
				{Key: "max_skewness", Value: 0.85, Provenance: ProvenanceDerived, Description: "Derived from mesh quality guidelines"},
				{Key: "min_orthogonality", Value: 35, Provenance: ProvenanceDerived, Description: "Minimum orthogonality angle"},
			},
			ValidationHints: []string{"Mesh refinement may increase computation time"},
		},
	}
}

func buildSolverProposals(intervention Intervention) []Proposal {
	return []Proposal{
		{
			ID:            "solver-fix-1",
			Target:        "case",
			Name:          "Reduce time step for stability",
			Intent:        "Adjust time stepping parameters to improve solver stability",
			Patch:         json.RawMessage(`{"time_stepping": {"cfl_number": 5, "max_steps": 10000}}`),
			BranchPreview: "stable-solver-config",
			Fields: []Field{
				{Key: "cfl_number", Value: 5, Provenance: ProvenanceDerived, Description: "Reduced from current value for stability"},
			},
			ValidationHints: []string{"May reduce convergence speed"},
		},
	}
}

func buildConvergenceProposals(intervention Intervention) []Proposal {
	return []Proposal{
		{
			ID:            "convergence-fix-1",
			Target:        "case",
			Name:          "Extended convergence with relaxation",
			Intent:        "Add under-relaxation to improve convergence behavior",
			Patch:         json.RawMessage(`{"solver": {"relaxation_factor": 0.7, "max_iterations": 50000}}`),
			BranchPreview: "relaxed-convergence",
			Fields: []Field{
				{Key: "relaxation_factor", Value: 0.7, Provenance: ProvenanceDerived, Description: "Under-relaxation for stability"},
				{Key: "max_iterations", Value: 50000, Provenance: ProvenanceDefaulted, Description: "Extended iteration limit"},
			},
			ValidationHints: []string{"May take longer to converge"},
		},
	}
}

func buildRemoteProposals(intervention Intervention) []Proposal {
	return []Proposal{
		{
			ID:            "remote-fix-1",
			Target:        "case",
			Name:          "Retry with conservative settings",
			Intent:        "Retry the operation with more conservative parameters",
			Patch:         json.RawMessage(`{"general": {"solver_type": "steady", "turbulence_model": "spalart_allmaras"}}`),
			BranchPreview: "conservative-retry",
			Fields: []Field{
				{Key: "solver_type", Value: "steady", Provenance: ProvenanceDefaulted, Description: "Steady-state solver"},
			},
			ValidationHints: []string{"Review previous failure logs before retrying"},
		},
	}
}

func buildGenericProposals(intervention Intervention) []Proposal {
	return []Proposal{
		{
			ID:              "generic-fix-1",
			Target:          "case",
			Name:            "Review and adjust configuration",
			Intent:          "Manual review of simulation configuration",
			Patch:           json.RawMessage(`{}`),
			BranchPreview:   "manual-review",
			Fields:          []Field{},
			ValidationHints: []string{"Review simulation parameters manually"},
		},
	}
}

func extractPreflightReason(issues []plans.PreflightIssue) string {
	if len(issues) == 0 {
		return "Preflight validation failed"
	}
	var reasons []string
	for _, issue := range issues {
		if issue.Level == "error" {
			reasons = append(reasons, issue.Message)
		}
	}
	if len(reasons) == 0 {
		reasons = append(reasons, issues[0].Message)
	}
	return strings.Join(reasons, "; ")
}

func determineRootCause(intervention Intervention) string {
	switch intervention.Type {
	case TypePreflightError:
		return "Missing or invalid simulation input parameters"
	case TypeMeshFailure:
		return "Mesh generation or quality issues"
	case TypeSolverFailure:
		return "Solver configuration or numerical instability"
	case TypeConvergenceAnomaly:
		return "Simulation failed to converge within tolerance"
	case TypeRemoteError:
		return "Remote execution error"
	default:
		return "Unknown simulation issue"
	}
}

func mapInterventionTypeToCategory(t string) string {
	switch t {
	case TypePreflightError:
		return ErrorMissingInputs
	case TypeMeshFailure:
		return ErrorMeshQuality
	case TypeSolverFailure:
		return ErrorSolverDivergence
	case TypeConvergenceAnomaly:
		return ErrorSolverDivergence
	case TypeRemoteError:
		return ErrorUnknown
	default:
		return ErrorUnknown
	}
}

func determineSeverity(intervention Intervention) string {
	switch intervention.Type {
	case TypePreflightError:
		return "medium"
	case TypeMeshFailure:
		return "high"
	case TypeSolverFailure:
		return "high"
	case TypeConvergenceAnomaly:
		return "medium"
	case TypeRemoteError:
		return "high"
	default:
		return "medium"
	}
}

func extractContributingFactors(intervention Intervention) []string {
	var factors []string
	for _, evidence := range intervention.Evidence {
		switch evidence.Type {
		case "preflight_issue":
			var data map[string]interface{}
			if err := json.Unmarshal(evidence.Content, &data); err == nil {
				if msg, ok := data["message"].(string); ok {
					factors = append(factors, msg)
				}
			}
		case "execution_error":
			factors = append(factors, "Flow360 execution error")
		}
	}
	return factors
}

func generateRecommendedActions(intervention Intervention) []string {
	switch intervention.Type {
	case TypePreflightError:
		return []string{
			"Review and complete missing simulation inputs",
			"Apply AI-recommended boundary conditions",
			"Validate configuration before resubmission",
		}
	case TypeMeshFailure:
		return []string{
			"Check mesh quality metrics",
			"Adjust mesh generation parameters",
			"Consider alternative mesh strategy",
		}
	case TypeSolverFailure:
		return []string{
			"Review solver settings",
			"Adjust time stepping parameters",
			"Consider alternative turbulence model",
		}
	case TypeConvergenceAnomaly:
		return []string{
			"Extend simulation duration",
			"Apply under-relaxation",
			"Review initial conditions",
		}
	case TypeRemoteError:
		return []string{
			"Check Flow360 service status",
			"Verify authentication and permissions",
			"Retry with adjusted parameters",
		}
	default:
		return []string{"Review configuration and retry"}
	}
}

func classifyRunError(err error) string {
	if err == nil {
		return ErrorUnknown
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "timeout"), strings.Contains(msg, "deadline"):
		return ErrorTimeout
	case strings.Contains(msg, "unauthorized"), strings.Contains(msg, "authentication"), strings.Contains(msg, "401"), strings.Contains(msg, "403"):
		return ErrorAuthentication
	case strings.Contains(msg, "network"), strings.Contains(msg, "connection"):
		return ErrorNetwork
	case strings.Contains(msg, "validation"), strings.Contains(msg, "invalid"), strings.Contains(msg, "schema"):
		return ErrorSchemaViolation
	default:
		return ErrorUnknown
	}
}

func mapErrorCategoryToType(category string) string {
	switch category {
	case ErrorSchemaViolation, ErrorMissingInputs:
		return TypePreflightError
	case ErrorSolverDivergence:
		return TypeSolverFailure
	case ErrorTimeout, ErrorAuthentication, ErrorNetwork:
		return TypeRemoteError
	default:
		return TypeRemoteError
	}
}
