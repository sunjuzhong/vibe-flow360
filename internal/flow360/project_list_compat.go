package flow360

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// projectListCompatibilityBridge reads the project endpoint without applying
// the SDK's closed rootItemType Literal. Flow360 occasionally introduces a new
// project root type before the installed SDK model is updated; one such record
// must not make the entire workspace inaccessible.
const projectListCompatibilityBridge = `
import json
import sys

from flow360.cloud.rest_api import RestApi
from flow360.component.interfaces import ProjectInterface
from flow360.environment import Env, current_environment

limit = int(sys.argv[1])
folder_id = sys.argv[2].strip()
environment_name = sys.argv[3].strip()
normalized_environment = environment_name.lower()
if normalized_environment in ("", "default", "prod", "production"):
    Env.prod.active()
elif normalized_environment == "dev":
    Env.dev.active()
elif normalized_environment == "uat":
    Env.uat.active()
else:
    Env.load(environment_name).active()

params = {
    "page": "0",
    "size": limit,
    "filterKeywords": "",
    "sortFields": ["createdAt"],
    "sortDirections": ["desc"],
}
if folder_id:
    params["filterFolderIds"] = [folder_id]
    params["filterExcludeSubfolders"] = True

api = RestApi(ProjectInterface.endpoint, id=None, environment_provider=current_environment)
response = api.get(params=params)

def asset_statistics(value):
    if not isinstance(value, dict):
        return None
    return {
        "count": value.get("count", 0),
        "success_count": value.get("successCount", 0),
        "running_count": value.get("runningCount", 0),
        "diverged_count": value.get("divergedCount", 0),
        "error_count": value.get("errorCount", 0),
    }

def project_statistics(value):
    value = value if isinstance(value, dict) else {}
    return {
        "geometry": asset_statistics(value.get("Geometry")),
        "surface_mesh": asset_statistics(value.get("SurfaceMesh")),
        "volume_mesh": asset_statistics(value.get("VolumeMesh")),
        "case": asset_statistics(value.get("Case")),
    }

records = []
for record in response.get("records", []):
    records.append({
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "root_item_type": record.get("rootItemType", "Unknown"),
        "solver_version": record.get("solverVersion"),
        "created_at": record.get("createdAt", ""),
        "tags": record.get("tags") or [],
        "description": record.get("description"),
        "statistics": project_statistics(record.get("statistics")),
    })

print(json.dumps({
    "records": records,
    "returned": len(records),
    "total": response.get("total", len(records)),
}))
`

func unsupportedProjectTypeError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "rootitemtype") &&
		strings.Contains(message, "literal_error")
}

func (c *Client) projectsWithoutStrictTypeValidation(
	parent context.Context,
	limit int,
	folderID string,
) (json.RawMessage, error) {
	python, err := c.flow360Python()
	if err != nil {
		return nil, fmt.Errorf("Flow360 project types are newer than the installed SDK: %w", err)
	}
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	command := exec.CommandContext(
		ctx,
		python,
		"-c",
		projectListCompatibilityBridge,
		strconv.Itoa(limit),
		strings.TrimSpace(folderID),
		strings.TrimSpace(c.Environment),
	)
	command.Env = append(os.Environ(), "SIMCLOUD_PROFILE="+strings.TrimSpace(c.Profile))
	if c.APIKey != "" {
		command.Env = append(command.Env, "FLOW360_APIKEY="+c.APIKey)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return nil, errors.New("Flow360 compatible project listing timed out")
	}
	if err != nil {
		message := compactOutput(stderr.Bytes())
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("Flow360 compatible project listing: %s", message)
	}
	raw, err := extractJSON(output)
	if err != nil {
		return nil, errors.New("Flow360 compatible project listing returned invalid JSON")
	}
	return raw, nil
}
