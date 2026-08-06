package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	DefaultFlow360Version = "25.10.*"
	DefaultPythonVersion  = "3.11"
	DefaultCadQuery       = "2.6.1"
	uvVersion             = "0.11.32"
)

type Runner interface {
	Run(ctx context.Context, environment []string, name string, args ...string) error
}

type ExecRunner struct {
	Stdout io.Writer
	Stderr io.Writer
	Stdin  io.Reader
}

func (runner ExecRunner) Run(ctx context.Context, environment []string, name string, args ...string) error {
	command := exec.CommandContext(ctx, name, args...)
	command.Env = append(os.Environ(), environment...)
	command.Stdout = runner.Stdout
	command.Stderr = runner.Stderr
	command.Stdin = runner.Stdin
	if err := command.Run(); err != nil {
		return fmt.Errorf("%s: %w", strings.Join(append([]string{name}, args...), " "), err)
	}
	return nil
}

type Options struct {
	ToolsDir       string
	UVBinary       string
	Flow360        string
	Python         string
	Profile        string
	Environment    string
	APIKey         string
	DownloadClient *http.Client
}

type Result struct {
	UVBinary      string
	Flow360Binary string
	CacheDir      string
	PythonDir     string
}

func Prepare(ctx context.Context, options Options, runner Runner) (Result, error) {
	if strings.TrimSpace(options.ToolsDir) == "" {
		return Result{}, errors.New("tools directory is required")
	}
	if options.Flow360 == "" {
		options.Flow360 = DefaultFlow360Version
	}
	if options.Python == "" {
		options.Python = DefaultPythonVersion
	}
	toolsDir, err := filepath.Abs(options.ToolsDir)
	if err != nil {
		return Result{}, err
	}
	for _, directory := range []string{
		filepath.Join(toolsDir, "bin"),
		filepath.Join(toolsDir, "cache"),
		filepath.Join(toolsDir, "python"),
		filepath.Join(toolsDir, "uv-tools"),
	} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return Result{}, fmt.Errorf("create tools directory: %w", err)
		}
	}

	uvBinary, err := ensureUV(ctx, options, toolsDir, runner)
	if err != nil {
		return Result{}, err
	}
	environment := uvEnvironment(toolsDir)
	packageSpec := "flow360==" + options.Flow360
	if err := runner.Run(ctx, environment, uvBinary, "tool", "install", "--python", options.Python, packageSpec); err != nil {
		return Result{}, fmt.Errorf("install Flow360 CLI %s: %w", options.Flow360, err)
	}

	flow360Binary := filepath.Join(toolsDir, "bin", executableName("flow360"))
	if !isExecutable(flow360Binary) {
		return Result{}, fmt.Errorf("Flow360 installation did not create %s", flow360Binary)
	}
	if err := runner.Run(ctx, environment, uvBinary,
		"run", "--no-project", "--python", options.Python,
		"--with", "cadquery=="+DefaultCadQuery,
		"python", "-c", "import cadquery; print('CadQuery runtime ready:', cadquery.__version__)",
	); err != nil {
		return Result{}, fmt.Errorf("prepare CadQuery %s runtime: %w", DefaultCadQuery, err)
	}
	if err := runner.Run(ctx, flow360Environment(options.APIKey), flow360Binary, "version"); err != nil {
		return Result{}, fmt.Errorf("verify Flow360 CLI: %w", err)
	}
	return Result{
		UVBinary:      uvBinary,
		Flow360Binary: flow360Binary,
		CacheDir:      filepath.Join(toolsDir, "cache"),
		PythonDir:     filepath.Join(toolsDir, "python"),
	}, nil
}

func VerifyAuthentication(ctx context.Context, runner Runner, binary, profile, environment, apiKey string) error {
	args := flow360GlobalArgs(profile, environment)
	args = append(args, "project", "list", "--limit", "1", "--format", "json")
	if err := runner.Run(ctx, flow360Environment(apiKey), binary, args...); err != nil {
		return fmt.Errorf("Flow360 authentication check failed: %w", err)
	}
	return nil
}

func Login(ctx context.Context, runner Runner, binary, profile, environment string) error {
	args := []string{"login"}
	if profile = strings.TrimSpace(profile); profile != "" {
		args = append(args, "--profile", profile)
	}
	if environment = strings.TrimSpace(environment); environment != "" {
		args = append(args, "--env", environment)
	}
	return runner.Run(ctx, nil, binary, args...)
}

func ensureUV(ctx context.Context, options Options, toolsDir string, runner Runner) (string, error) {
	if configured := strings.TrimSpace(options.UVBinary); configured != "" {
		path, err := exec.LookPath(configured)
		if err != nil {
			return "", fmt.Errorf("find configured uv binary: %w", err)
		}
		return path, nil
	}
	managedBinary := filepath.Join(toolsDir, "bin", executableName("uv"))
	if isExecutable(managedBinary) {
		return managedBinary, nil
	}
	if runtime.GOOS == "windows" {
		return "", errors.New("automatic uv bootstrap is not yet supported on Windows; install uv and rerun with --uv")
	}

	client := options.DownloadClient
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	url := fmt.Sprintf("https://astral.sh/uv/%s/install.sh", uvVersion)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("download uv installer: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download uv installer: HTTP %s", response.Status)
	}
	installerBody, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil {
		return "", fmt.Errorf("download uv installer: %w", err)
	}
	if len(installerBody) > 2<<20 {
		return "", errors.New("download uv installer: response exceeded 2 MiB")
	}
	installer, err := os.CreateTemp("", "vibe-flow360-uv-install-*.sh")
	if err != nil {
		return "", err
	}
	installerPath := installer.Name()
	defer os.Remove(installerPath)
	if _, err := installer.Write(installerBody); err != nil {
		installer.Close()
		return "", fmt.Errorf("save uv installer: %w", err)
	}
	if err := installer.Close(); err != nil {
		return "", err
	}
	binDir := filepath.Join(toolsDir, "bin")
	if err := runner.Run(ctx, []string{
		"UV_UNMANAGED_INSTALL=" + binDir,
		"UV_NO_MODIFY_PATH=1",
	}, "sh", installerPath); err != nil {
		return "", fmt.Errorf("install uv %s: %w", uvVersion, err)
	}
	uvBinary := managedBinary
	if !isExecutable(uvBinary) {
		return "", fmt.Errorf("uv installer did not create %s", uvBinary)
	}
	return uvBinary, nil
}

func uvEnvironment(toolsDir string) []string {
	return []string{
		"UV_TOOL_DIR=" + filepath.Join(toolsDir, "uv-tools"),
		"UV_TOOL_BIN_DIR=" + filepath.Join(toolsDir, "bin"),
		"UV_PYTHON_INSTALL_DIR=" + filepath.Join(toolsDir, "python"),
		"UV_CACHE_DIR=" + filepath.Join(toolsDir, "cache"),
	}
}

func flow360GlobalArgs(profile, environment string) []string {
	args := make([]string, 0, 4)
	if profile = strings.TrimSpace(profile); profile != "" {
		args = append(args, "--profile", profile)
	}
	switch environment = strings.TrimSpace(environment); strings.ToLower(environment) {
	case "":
	case "dev":
		args = append(args, "--dev")
	case "uat":
		args = append(args, "--uat")
	default:
		args = append(args, "--env", environment)
	}
	return args
}

func flow360Environment(apiKey string) []string {
	if strings.TrimSpace(apiKey) == "" {
		return nil
	}
	return []string{"FLOW360_APIKEY=" + apiKey}
}

func executableName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && (runtime.GOOS == "windows" || info.Mode().Perm()&0o111 != 0)
}
