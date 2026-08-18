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
)

const maxResourceDetailOutputSize = 128 * 1024 * 1024

// resourceSimulationBridge deliberately fetches SimulationParams once. The
// Flow360 CLI's `summary` command fetches the same potentially large payload a
// second time, which doubles remote work and made large Project syncs time out.
const resourceSimulationBridge = `
import json
import contextlib
import sys
import time

from requests.exceptions import RequestException
from flow360.cli.simulation_summary import summarize_simulation
from flow360.component.simulation.web import asset_webapi
from flow360.environment import Env

resource_type = sys.argv[1]
resource_id = sys.argv[2]
environment_name = sys.argv[3].strip()
max_attempts = max(1, int(sys.argv[4]))
normalized_environment = environment_name.lower()
if normalized_environment in ("", "default", "prod", "production"):
    Env.prod.active()
elif normalized_environment == "dev":
    Env.dev.active()
elif normalized_environment == "uat":
    Env.uat.active()
else:
    Env.load(environment_name).active()

webapi_classes = {
    "Geometry": asset_webapi.GeometryWebApi,
    "SurfaceMesh": asset_webapi.SurfaceMeshWebApi,
    "VolumeMesh": asset_webapi.VolumeMeshWebApi,
    "Case": asset_webapi.CaseWebApi,
}
for attempt in range(max_attempts):
    try:
        # Some SDK/runtime versions write progress or compatibility messages to
        # stdout. Keep stdout reserved for the single structured JSON envelope
        # consumed by the Go bridge.
        with contextlib.redirect_stdout(sys.stderr):
            simulation_params = webapi_classes[resource_type](resource_id).get_simulation_params()
        break
    except RequestException:
        if attempt == max_attempts - 1:
            raise
        time.sleep(min(2 ** attempt, 8))
payload = {"simulation_params": simulation_params}
try:
    with contextlib.redirect_stdout(sys.stderr):
        payload["summary"] = {
            "id": resource_id,
            "summary": summarize_simulation(simulation_params),
        }
except Exception as error:  # Summary is derived, so preserve usable raw params.
    payload["summary_error"] = f"{type(error).__name__}: {error}"
print(json.dumps(payload))
`

type resourceSimulationPayload struct {
	SimulationParams json.RawMessage `json:"simulation_params"`
	Summary          json.RawMessage `json:"summary"`
	SummaryError     string          `json:"summary_error"`
}

func (c *Client) resourceSimulationData(
	ctx context.Context,
	resourceType string,
	resourceID string,
) (json.RawMessage, json.RawMessage, error, error) {
	params, summary, summaryErr, commandErr := c.resourceSimulationDataOnce(ctx, resourceType, resourceID)
	if commandErr == nil {
		return params, summary, summaryErr, nil
	}
	retry, compatibilityErr := c.prepareCompatibleUpgrade(ctx, commandErr)
	if compatibilityErr != nil {
		return nil, nil, nil, compatibilityErr
	}
	if !retry {
		return nil, nil, nil, commandErr
	}
	return c.resourceSimulationDataOnce(ctx, resourceType, resourceID)
}

func (c *Client) resourceSimulationDataOnce(
	ctx context.Context,
	resourceType string,
	resourceID string,
) (json.RawMessage, json.RawMessage, error, error) {
	python, err := c.flow360Python()
	if err != nil {
		// Non-Python test doubles and legacy installations can still return the
		// core payload. Summary remains optional and its absence must not turn a
		// successful SimulationParams fetch into a degraded resource.
		command, _, commandErr := resourceCommand(resourceType)
		if commandErr != nil {
			return nil, nil, nil, commandErr
		}
		raw, paramsErr := c.jsonCommandWithTimeout(
			ctx, c.resourceCommandTimeout(), command, "simulation-params", "get", resourceID,
		)
		if paramsErr != nil {
			return nil, nil, nil, paramsErr
		}
		return unwrapSimulationParamsPayload(raw), nil, nil, nil
	}

	runCtx, cancel := context.WithTimeout(ctx, c.resourceCommandTimeout())
	defer cancel()
	command := exec.CommandContext(
		runCtx,
		python,
		"-c",
		resourceSimulationBridge,
		resourceType,
		resourceID,
		strings.TrimSpace(c.Environment),
		fmt.Sprintf("%d", c.resourceRetryCount()+1),
	)
	command.Env = append(os.Environ(), "SIMCLOUD_PROFILE="+strings.TrimSpace(c.Profile))
	if c.APIKey != "" {
		command.Env = append(command.Env, "FLOW360_APIKEY="+c.APIKey)
	}
	var stdout cappedBuffer
	stdout.limit = maxResourceDetailOutputSize
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return nil, nil, nil, fmt.Errorf(
				"Flow360 SimulationParams fetch timed out after %s", c.resourceCommandTimeout(),
			)
		}
		message := compactOutput(stderr.Bytes())
		if message == "" {
			message = err.Error()
		}
		return nil, nil, nil, fmt.Errorf("Flow360 SimulationParams fetch failed: %s", message)
	}
	if stdout.exceeded {
		return nil, nil, nil, fmt.Errorf(
			"Flow360 SimulationParams response exceeds %d MiB", maxResourceDetailOutputSize/(1024*1024),
		)
	}
	var payload resourceSimulationPayload
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil || !json.Valid(payload.SimulationParams) {
		return nil, nil, nil, errors.New("Flow360 SimulationParams fetch returned invalid JSON")
	}
	var summaryErr error
	if value := strings.TrimSpace(payload.SummaryError); value != "" {
		summaryErr = errors.New(value)
	}
	return payload.SimulationParams, payload.Summary, summaryErr, nil
}

// CriticalResourceDetailErrors excludes failures of locally derived,
// non-essential fields. Callers can retain and serve a complete remote
// snapshot when only summary generation failed.
func CriticalResourceDetailErrors(operationErrors map[string]string) map[string]string {
	critical := make(map[string]string)
	for operation, message := range operationErrors {
		if operation != "summary" {
			critical[operation] = message
		}
	}
	return critical
}
