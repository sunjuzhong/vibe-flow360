package flow360

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// DraftRunOptions contains the Flow360 run flags that are not part of the
// public SimulationParams schema. They are derived from the canonical Draft
// cache immediately before submission.
type DraftRunOptions struct {
	UseInHouse bool
	UseGAI     bool
}

const draftRunWithOptionsBridge = `
import json
import contextlib
import sys
from flow360.component.simulation.web.asset_webapi import DraftWebApi

draft_id, up_to, use_in_house, use_gai = sys.argv[1:]
with contextlib.redirect_stdout(sys.stderr):
    result = DraftWebApi(draft_id).run(
        up_to=up_to,
        use_in_house=use_in_house == "true",
        use_gai=use_gai == "true",
    )
print(json.dumps(result))
`

const convertDraftUnitSystemBridge = `
import copy
import json
import contextlib
import sys
from flow360.component.simulation.services import change_unit_system

params = json.loads(sys.stdin.read())
target = sys.argv[1]
with contextlib.redirect_stdout(sys.stderr):
    converted = change_unit_system(data=copy.deepcopy(params), target_unit_system=target)
print(json.dumps(converted))
`

// RunExistingDraftWithOptions submits a reviewed Draft with explicit
// mesher/GeometryAI flags. The stock CLI currently does not expose these
// DraftWebApi.run options, so use the installed Flow360 Python runtime.
func (c *Client) RunExistingDraftWithOptions(ctx context.Context, draftID, target string, options DraftRunOptions) (json.RawMessage, error) {
	if strings.TrimSpace(draftID) == "" {
		return nil, errors.New("Draft ID is required")
	}
	if options.UseGAI && !options.UseInHouse {
		return nil, errors.New("Geometry AI requires the beta mesher")
	}
	python, err := c.flow360Python()
	if err != nil {
		return nil, err
	}
	runCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	command := exec.CommandContext(
		runCtx,
		python,
		"-c",
		draftRunWithOptionsBridge,
		strings.TrimSpace(draftID),
		strings.ToLower(strings.TrimSpace(target)),
		fmt.Sprintf("%t", options.UseInHouse),
		fmt.Sprintf("%t", options.UseGAI),
	)
	command.Env = append(os.Environ(), "SIMCLOUD_PROFILE="+strings.TrimSpace(c.Profile))
	if c.APIKey != "" {
		command.Env = append(command.Env, "FLOW360_APIKEY="+c.APIKey)
	}
	var stdout cappedBuffer
	stdout.limit = maxPreflightOutputSize
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("Flow360 Draft run timed out")
		}
		message := compactOutput(stderr.Bytes())
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("Flow360 Draft run failed: %s", message)
	}
	if stdout.exceeded {
		return nil, errors.New("Flow360 Draft run output exceeds the size limit")
	}
	return extractJSON(stdout.Bytes())
}

// RunDraftWithOptions is the source-resource variant used by plan execution.
// Creation and parameter upload remain on the established CLI path; the final
// run uses the Python bridge so the explicit options are not lost.
func (c *Client) RunDraftWithOptions(ctx context.Context, sourceID, name, target string, patch json.RawMessage, options DraftRunOptions) (json.RawMessage, error) {
	created, err := c.CreateDraft(ctx, sourceID, name)
	if err != nil {
		return nil, err
	}
	draftID := draftIDFromPayload(created)
	if draftID == "" {
		return nil, errors.New("Flow360 created a Draft but did not return its ID")
	}
	detail, err := c.ResourceDetail(ctx, "Draft", draftID)
	if err != nil || len(detail.SimulationParams) == 0 {
		if err == nil {
			err = errors.New("Draft SimulationParams are unavailable")
		}
		return nil, err
	}
	merged, err := mergeJSONMergePatch(detail.SimulationParams, patch)
	if err != nil {
		return nil, err
	}
	if _, err := c.SetDraftSimulationParams(ctx, draftID, merged); err != nil {
		return nil, err
	}
	return c.RunExistingDraftWithOptions(ctx, draftID, target, options)
}

// ConvertDraftParameterUnitSystem applies Flow360's own quantity conversion
// rules and returns a candidate. It does not write the Draft.
func (c *Client) ConvertDraftParameterUnitSystem(ctx context.Context, params json.RawMessage, target string) (json.RawMessage, error) {
	target = strings.TrimSpace(target)
	if target != "SI" && target != "Imperial" && target != "CGS" {
		return nil, errors.New("unsupported unit system; choose SI, Imperial, or CGS")
	}
	if !json.Valid(params) {
		return nil, errors.New("SimulationParams must be valid JSON")
	}
	python, err := c.flow360Python()
	if err != nil {
		return nil, err
	}
	runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	command := exec.CommandContext(runCtx, python, "-c", convertDraftUnitSystemBridge, target)
	command.Env = append(os.Environ(), "SIMCLOUD_PROFILE="+strings.TrimSpace(c.Profile))
	if c.APIKey != "" {
		command.Env = append(command.Env, "FLOW360_APIKEY="+c.APIKey)
	}
	command.Stdin = bytes.NewReader(params)
	var stdout cappedBuffer
	stdout.limit = maxPreflightOutputSize
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("Flow360 unit conversion timed out")
		}
		message := compactOutput(stderr.Bytes())
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("Flow360 unit conversion failed: %s", message)
	}
	if stdout.exceeded {
		return nil, errors.New("Flow360 unit conversion output exceeds the size limit")
	}
	converted, err := extractJSON(stdout.Bytes())
	if err != nil || !json.Valid(converted) {
		return nil, errors.New("Flow360 unit conversion returned invalid JSON")
	}
	return converted, nil
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func mergeJSONMergePatch(baseline, patch json.RawMessage) (json.RawMessage, error) {
	var baseValue any = map[string]any{}
	if len(baseline) > 0 {
		if err := json.Unmarshal(baseline, &baseValue); err != nil {
			return nil, errors.New("Flow360 baseline SimulationParams is invalid")
		}
	}
	var patchValue any
	if err := json.Unmarshal(patch, &patchValue); err != nil {
		return nil, errors.New("SimulationParams patch is invalid")
	}
	merged := mergeJSONValue(baseValue, patchValue)
	if _, ok := merged.(map[string]any); !ok {
		return nil, errors.New("SimulationParams patch must produce an object")
	}
	return json.Marshal(merged)
}

func mergeJSONValue(base, patch any) any {
	patchObject, ok := patch.(map[string]any)
	if !ok {
		return patch
	}
	baseObject, _ := base.(map[string]any)
	merged := make(map[string]any, len(baseObject)+len(patchObject))
	for key, value := range baseObject {
		merged[key] = value
	}
	for key, value := range patchObject {
		if value == nil {
			delete(merged, key)
			continue
		}
		merged[key] = mergeJSONValue(merged[key], value)
	}
	return merged
}
