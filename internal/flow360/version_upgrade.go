package flow360

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	// SupportedRelease is the single Flow360 schema release line supported by
	// this Vibe Flow360 build. Patch updates inside the line are automatic;
	// supporting another release line requires a Vibe Flow360 release.
	SupportedRelease            = "25.10"
	SupportedVersionConstraint  = SupportedRelease + ".*"
	defaultManagedPythonVersion = "3.11"
)

var schemaVersionMismatchPattern = regexp.MustCompile(
	`(?is)cloud\s+[^\n]*?\(version:\s*([0-9]+(?:\.[0-9]+)+)\).*?local\s+schema\s+package\s+\(version:\s*([0-9]+(?:\.[0-9]+)+)\)`,
)

var numericVersionPattern = regexp.MustCompile(`[0-9]+(?:\.[0-9]+){2,}`)

// ReleaseCompatibilityError is safe to show to users. It intentionally hides
// Python parser details such as KeyError while preserving versions for a clear
// upgrade action.
type ReleaseCompatibilityError struct {
	CloudVersion string
}

func (e *ReleaseCompatibilityError) Error() string {
	return fmt.Sprintf(
		"This Project uses Flow360 %s parameters. Upgrade to a Vibe Flow360 release that supports Flow360 %s.",
		e.CloudVersion, releaseLine(e.CloudVersion),
	)
}

func (e *ReleaseCompatibilityError) Code() string { return "flow360_release_not_supported" }

type CompatibleUpgradeError struct {
	TargetVersion string
	Err           error
}

func (e *CompatibleUpgradeError) Error() string {
	return fmt.Sprintf(
		"Vibe Flow360 could not update its Flow360 %s compatibility components automatically. Retry after checking the network connection.",
		SupportedRelease,
	)
}

func (e *CompatibleUpgradeError) Unwrap() error { return e.Err }
func (e *CompatibleUpgradeError) Code() string  { return "flow360_compatible_upgrade_failed" }

// CompatibilityErrorCode returns a stable API-facing code for errors caused
// by the Flow360 release policy.
func CompatibilityErrorCode(err error) string {
	var coded interface{ Code() string }
	if errors.As(err, &coded) {
		return coded.Code()
	}
	return ""
}

func (c *Client) prepareCompatibleUpgrade(ctx context.Context, cause error) (bool, error) {
	cloudVersion, localVersion, ok := schemaVersionMismatch(cause)
	if !ok || compareNumericVersions(cloudVersion, localVersion) <= 0 {
		return false, nil
	}
	if releaseLine(cloudVersion) != SupportedRelease {
		return false, &ReleaseCompatibilityError{CloudVersion: cloudVersion}
	}

	c.upgradeMu.Lock()
	defer c.upgradeMu.Unlock()
	if compareNumericVersions(c.upgradedThrough, cloudVersion) >= 0 {
		return true, nil
	}
	if c.UpgradeCompatible == nil {
		return false, &CompatibleUpgradeError{TargetVersion: cloudVersion, Err: errors.New("automatic updater is unavailable")}
	}
	if err := c.UpgradeCompatible(ctx, cloudVersion, SupportedVersionConstraint); err != nil {
		return false, &CompatibleUpgradeError{TargetVersion: cloudVersion, Err: err}
	}
	c.upgradedThrough = cloudVersion
	return true, nil
}

func schemaVersionMismatch(err error) (cloudVersion, localVersion string, ok bool) {
	if err == nil {
		return "", "", false
	}
	match := schemaVersionMismatchPattern.FindStringSubmatch(err.Error())
	if len(match) != 3 {
		return "", "", false
	}
	return match[1], match[2], true
}

func releaseLine(version string) string {
	parts := strings.Split(strings.TrimSpace(version), ".")
	if len(parts) < 2 {
		return strings.TrimSpace(version)
	}
	return parts[0] + "." + parts[1]
}

func compareNumericVersions(left, right string) int {
	leftParts := strings.Split(strings.TrimSpace(left), ".")
	rightParts := strings.Split(strings.TrimSpace(right), ".")
	length := len(leftParts)
	if len(rightParts) > length {
		length = len(rightParts)
	}
	for index := 0; index < length; index++ {
		var leftValue, rightValue int
		if index < len(leftParts) {
			leftValue, _ = strconv.Atoi(leftParts[index])
		}
		if index < len(rightParts) {
			rightValue, _ = strconv.Atoi(rightParts[index])
		}
		if leftValue < rightValue {
			return -1
		}
		if leftValue > rightValue {
			return 1
		}
	}
	return 0
}

func (c *Client) upgradeManagedRuntime(ctx context.Context, targetVersion, constraint string) error {
	binary, err := exec.LookPath(c.Binary)
	if err != nil {
		return fmt.Errorf("find managed Flow360 binary: %w", err)
	}
	binDir := filepath.Dir(binary)
	toolsDir := filepath.Dir(binDir)
	if filepath.Base(binDir) != "bin" {
		return errors.New("Flow360 is not installed in the Vibe Flow360 managed runtime")
	}
	if info, statErr := os.Stat(filepath.Join(toolsDir, "uv-tools")); statErr != nil || !info.IsDir() {
		return errors.New("Flow360 managed runtime metadata is unavailable")
	}
	uvBinary := strings.TrimSpace(os.Getenv("VIBESIM_UV_BINARY"))
	if uvBinary == "" {
		name := "uv"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		uvBinary = filepath.Join(binDir, name)
	}
	if info, statErr := os.Stat(uvBinary); statErr != nil || info.IsDir() {
		return errors.New("the managed uv updater is unavailable")
	}
	if runtime.GOOS == "windows" {
		return errors.New("automatic managed-runtime switching is not yet supported on Windows")
	}
	runtimesDir := filepath.Join(toolsDir, "runtimes")
	if err := os.MkdirAll(runtimesDir, 0o700); err != nil {
		return fmt.Errorf("create managed runtime directory: %w", err)
	}
	stageDir, err := os.MkdirTemp(runtimesDir, "flow360-"+strings.ReplaceAll(targetVersion, ".", "-")+"-")
	if err != nil {
		return fmt.Errorf("create staged Flow360 runtime: %w", err)
	}
	activated := false
	defer func() {
		if !activated {
			_ = os.RemoveAll(stageDir)
		}
	}()
	stageBinDir := filepath.Join(stageDir, "bin")
	if err := os.MkdirAll(stageBinDir, 0o700); err != nil {
		return fmt.Errorf("create staged Flow360 bin directory: %w", err)
	}

	updateCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	command := exec.CommandContext(
		updateCtx,
		uvBinary,
		"tool", "install", "--upgrade",
		"--python", firstNonEmpty(os.Getenv("VIBESIM_CAD_PYTHON"), defaultManagedPythonVersion),
		"flow360=="+constraint,
	)
	command.Env = append(os.Environ(),
		"UV_TOOL_DIR="+filepath.Join(stageDir, "uv-tools"),
		"UV_TOOL_BIN_DIR="+stageBinDir,
		"UV_PYTHON_INSTALL_DIR="+filepath.Join(toolsDir, "python"),
		"UV_CACHE_DIR="+filepath.Join(toolsDir, "cache"),
	)
	output, err := command.CombinedOutput()
	if err != nil {
		message := compactOutput(output)
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("upgrade managed Flow360 runtime: %s", message)
	}
	stageBinary := filepath.Join(stageBinDir, filepath.Base(binary))
	if info, statErr := os.Stat(stageBinary); statErr != nil || info.IsDir() || info.Mode().Perm()&0o111 == 0 {
		return errors.New("staged Flow360 update did not produce an executable")
	}
	verify := exec.CommandContext(updateCtx, stageBinary, "version")
	verify.Env = append(os.Environ(), "SIMCLOUD_PROFILE="+strings.TrimSpace(c.Profile))
	versionOutput, err := verify.CombinedOutput()
	if err != nil {
		return fmt.Errorf("verify staged Flow360 runtime: %s", compactOutput(versionOutput))
	}
	installedVersion := highestVersionInOutput(string(versionOutput), SupportedRelease)
	if compareNumericVersions(installedVersion, targetVersion) < 0 {
		return fmt.Errorf("latest available compatible runtime is %s, but the Project requires %s", installedVersion, targetVersion)
	}

	nextLink := filepath.Join(binDir, ".flow360-next-"+strings.ReplaceAll(targetVersion, ".", "-"))
	_ = os.Remove(nextLink)
	if err := os.Symlink(stageBinary, nextLink); err != nil {
		return fmt.Errorf("prepare managed Flow360 runtime switch: %w", err)
	}
	if err := os.Rename(nextLink, binary); err != nil {
		_ = os.Remove(nextLink)
		return fmt.Errorf("activate managed Flow360 runtime: %w", err)
	}
	activated = true
	return nil
}

func highestVersionInOutput(output, release string) string {
	result := ""
	for _, candidate := range numericVersionPattern.FindAllString(output, -1) {
		if releaseLine(candidate) == release && compareNumericVersions(candidate, result) > 0 {
			result = candidate
		}
	}
	return result
}
