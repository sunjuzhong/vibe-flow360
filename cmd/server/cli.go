package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sunjuzhong/vibe-flow360/internal/bootstrap"
	"github.com/sunjuzhong/vibe-flow360/internal/config"
	"github.com/sunjuzhong/vibe-flow360/internal/projectmirror"
	"github.com/sunjuzhong/vibe-flow360/internal/server"
)

const commandName = "vibe-flow360"

// buildVersion is injected by release builds. Development builds deliberately
// report "dev" so an unversioned binary cannot be mistaken for a release.
var buildVersion = "dev"

func runCLI(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		writeRootUsage(stdout)
		return nil
	}
	switch args[0] {
	case "help", "-h", "--help":
		writeRootUsage(stdout)
		return nil
	case "serve":
		return runServe(args[1:], stdout, stderr)
	case "clean-mirror":
		return runCleanMirror(args[1:], stdout, stderr)
	case "init":
		return runInit(args[1:], stdin, stdout, stderr)
	case "version":
		if len(args) != 1 {
			return errors.New("version does not accept arguments")
		}
		fmt.Fprintf(stdout, "%s %s\n", commandName, buildVersion)
		return nil
	default:
		return fmt.Errorf("unknown command %q; run %s --help", args[0], commandName)
	}
}

func writeRootUsage(output io.Writer) {
	fmt.Fprintf(output, `Vibe Flow360 prepares and runs the local CFD copilot.

Usage:
  %s init [options]   Install and verify all runtime dependencies
  %s serve [options]  Start the Vibe Flow360 server
  %s clean-mirror     Remove mirrored Project files older than one week
  %s version          Print the build/Flow360 version

Run "%s <command> --help" for command options.
`, commandName, commandName, commandName, commandName, commandName)
}

func runCleanMirror(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("clean-mirror", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dataDir := flags.String("data-dir", firstValue(os.Getenv("VIBESIM_DATA_DIR"), ".vibesim"), "VibeSim data directory")
	olderThan := flags.Duration("older-than", 7*24*time.Hour, "minimum file age to remove")
	flags.Usage = func() {
		fmt.Fprintf(flags.Output(), "Usage: %s clean-mirror [--data-dir .vibesim] [--older-than 168h]\n", commandName)
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("clean-mirror does not accept positional arguments")
	}
	if *olderThan <= 0 {
		return errors.New("--older-than must be positive")
	}
	root := filepath.Join(*dataDir, "projects")
	result, err := projectmirror.CleanupRootOlderThan(root, time.Now().Add(-*olderThan))
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "Cleaned %s: removed %d files, %d bytes, %d empty directories", result.Root, result.RemovedFiles, result.RemovedBytes, result.RemovedDirs)
	if result.FailedRemovals > 0 {
		fmt.Fprintf(stdout, ", %d failures", result.FailedRemovals)
	}
	fmt.Fprintln(stdout)
	return nil
}

func runServe(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	flags.SetOutput(stderr)
	address := flags.String("addr", ":9292", "HTTP listen address")
	envFile := flags.String("env-file", ".env", "dotenv file to load")
	flags.Usage = func() {
		fmt.Fprintf(flags.Output(), "Usage: %s serve [--addr :9292] [--env-file .env]\n", commandName)
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("serve does not accept positional arguments")
	}
	if err := config.LoadDotEnv(*envFile); err != nil {
		return fmt.Errorf("load %s: %w", *envFile, err)
	}

	logger := log.New(stderr, "", log.LstdFlags)
	app := server.New()
	logger.Printf("Vibe Flow360 is available at %s", serverURL(*address))
	if err := app.Run(*address); err != nil {
		return err
	}
	return nil
}

func serverURL(address string) string {
	address = strings.TrimSpace(address)
	if strings.HasPrefix(address, ":") {
		return "http://localhost" + address
	}
	if strings.HasPrefix(address, "http://") || strings.HasPrefix(address, "https://") {
		return address
	}
	return "http://" + address
}

func runInit(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("init", flag.ContinueOnError)
	flags.SetOutput(stderr)
	envFile := flags.String("env-file", ".env", "dotenv file to create or update")
	toolsDir := flags.String("tools-dir", "", "isolated runtime directory (default: user config directory)")
	flow360Version := flags.String("flow360-version", bootstrap.DefaultFlow360Version, "Flow360 Python API/CLI version constraint")
	profile := flags.String("profile", "", "Flow360 profile (default: existing value or default)")
	environment := flags.String("environment", "", "Flow360 environment: production, dev, uat, or a named environment")
	uvBinary := flags.String("uv", "", "existing uv executable to use")
	noLogin := flags.Bool("no-login", false, "do not launch browser login when authentication is missing")
	skipAuthCheck := flags.Bool("skip-auth-check", false, "prepare runtimes without verifying a Flow360 account (CI/image builds only)")
	flags.Usage = func() {
		fmt.Fprintf(flags.Output(), "Usage: %s init [options]\n", commandName)
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("init does not accept positional arguments")
	}

	envPath, err := filepath.Abs(*envFile)
	if err != nil {
		return fmt.Errorf("resolve env file: %w", err)
	}
	existing, err := config.ReadDotEnv(envPath)
	if err != nil {
		return err
	}
	selectedProfile := firstValue(*profile, existing["VIBESIM_FLOW360_PROFILE"], os.Getenv("VIBESIM_FLOW360_PROFILE"), "default")
	selectedEnvironment := normalizeEnvironment(firstValue(*environment, existing["VIBESIM_FLOW360_ENV"], os.Getenv("VIBESIM_FLOW360_ENV")))
	apiKey := firstValue(existing["FLOW360_APIKEY"], os.Getenv("FLOW360_APIKEY"), os.Getenv("VIBESIM_FLOW360_API_KEY"))
	selectedToolsDir := strings.TrimSpace(*toolsDir)
	if selectedToolsDir == "" {
		configDir, configErr := os.UserConfigDir()
		if configErr != nil {
			return fmt.Errorf("find user config directory: %w", configErr)
		}
		selectedToolsDir = filepath.Join(configDir, "vibe-flow360", "runtime")
	}

	fmt.Fprintf(stdout, "Preparing isolated runtime in %s\n", selectedToolsDir)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	runner := bootstrap.ExecRunner{Stdout: stdout, Stderr: stderr, Stdin: stdin}
	result, err := bootstrap.Prepare(ctx, bootstrap.Options{
		ToolsDir:    selectedToolsDir,
		UVBinary:    firstValue(*uvBinary, existing["VIBESIM_UV_BINARY"], os.Getenv("VIBESIM_UV_BINARY")),
		Flow360:     strings.TrimSpace(*flow360Version),
		Profile:     selectedProfile,
		Environment: selectedEnvironment,
		APIKey:      apiKey,
	}, runner)
	if err != nil {
		return err
	}

	authenticationVerified := false
	if !*skipAuthCheck {
		quietRunner := bootstrap.ExecRunner{Stdout: io.Discard, Stderr: stderr, Stdin: stdin}
		authErr := bootstrap.VerifyAuthentication(ctx, quietRunner, result.Flow360Binary, selectedProfile, selectedEnvironment, apiKey)
		if authErr != nil && !*noLogin && interactiveInput(stdin) {
			fmt.Fprintln(stdout, "Flow360 authentication is required; opening the official browser login flow...")
			if err := bootstrap.Login(ctx, runner, result.Flow360Binary, selectedProfile, selectedEnvironment); err != nil {
				return fmt.Errorf("Flow360 login: %w", err)
			}
			// A stored browser credential must not be shadowed by a stale key from
			// the old dotenv file or process environment.
			apiKey = ""
			authErr = bootstrap.VerifyAuthentication(ctx, quietRunner, result.Flow360Binary, selectedProfile, selectedEnvironment, apiKey)
		}
		if authErr != nil {
			return fmt.Errorf("%w; set FLOW360_APIKEY or rerun interactively to log in", authErr)
		}
		authenticationVerified = true
	}

	dataDir := firstValue(existing["VIBESIM_DATA_DIR"], os.Getenv("VIBESIM_DATA_DIR"))
	if dataDir == "" {
		dataDir = filepath.Join(filepath.Dir(envPath), ".vibesim")
	} else if !filepath.IsAbs(dataDir) {
		dataDir = filepath.Join(filepath.Dir(envPath), dataDir)
	}
	updates := map[string]string{
		"FLOW360_APIKEY":              apiKey,
		"VIBESIM_AGENT_PROVIDER":      firstValue(existing["VIBESIM_AGENT_PROVIDER"], "builtin"),
		"VIBESIM_CAD_OFFLINE":         firstValue(existing["VIBESIM_CAD_OFFLINE"], "false"),
		"VIBESIM_CAD_PYTHON":          bootstrap.DefaultPythonVersion,
		"VIBESIM_CAD_TIMEOUT_SECONDS": firstValue(existing["VIBESIM_CAD_TIMEOUT_SECONDS"], "90"),
		"VIBESIM_DATA_DIR":            dataDir,
		"VIBESIM_FLOW360_BINARY":      result.Flow360Binary,
		"VIBESIM_FLOW360_ENV":         selectedEnvironment,
		"VIBESIM_FLOW360_PROFILE":     selectedProfile,
		"VIBESIM_FLOW360_RESOURCE_TIMEOUT_SECONDS": firstValue(
			existing["VIBESIM_FLOW360_RESOURCE_TIMEOUT_SECONDS"], "1800",
		),
		"VIBESIM_FLOW360_RESOURCE_RETRIES": firstValue(
			existing["VIBESIM_FLOW360_RESOURCE_RETRIES"], "3",
		),
		"VIBESIM_UV_BINARY":             result.UVBinary,
		"VIBESIM_UV_CACHE_DIR":          result.CacheDir,
		"VIBESIM_UV_PYTHON_INSTALL_DIR": result.PythonDir,
	}
	if err := config.UpdateDotEnv(envPath, updates); err != nil {
		return fmt.Errorf("write %s: %w", envPath, err)
	}

	fmt.Fprintf(stdout, "\nInitialization complete. Configuration: %s\n", envPath)
	fmt.Fprintf(stdout, "Flow360 CLI: %s (%s)\n", result.Flow360Binary, *flow360Version)
	fmt.Fprintf(stdout, "CadQuery: %s on Python %s\n", bootstrap.DefaultCadQuery, bootstrap.DefaultPythonVersion)
	if authenticationVerified {
		fmt.Fprintf(stdout, "Authentication: verified (profile %s, environment %s)\n", selectedProfile, displayEnvironment(selectedEnvironment))
	} else {
		fmt.Fprintln(stdout, "Authentication: skipped; run init again without --skip-auth-check before normal use")
	}
	if envPath == filepath.Join(mustWorkingDirectory(), ".env") {
		fmt.Fprintf(stdout, "Start with: %s serve\n", commandName)
	} else {
		fmt.Fprintf(stdout, "Start with: %s serve --env-file %s\n", commandName, envPath)
	}
	return nil
}

func mustWorkingDirectory() string {
	directory, err := os.Getwd()
	if err != nil {
		return ""
	}
	return directory
}

func interactiveInput(input io.Reader) bool {
	file, ok := input.(*os.File)
	if !ok {
		return false
	}
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func normalizeEnvironment(value string) string {
	value = strings.TrimSpace(value)
	if strings.EqualFold(value, "production") || strings.EqualFold(value, "prod") {
		return ""
	}
	return value
}

func displayEnvironment(value string) string {
	if strings.TrimSpace(value) == "" {
		return "production"
	}
	return value
}

func firstValue(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
