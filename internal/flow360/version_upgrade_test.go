package flow360

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const newerPatchWarning = "The cloud `SimulationParam` (version: 25.10.18) is too new for your local schema package (version: 25.10.17). Errors may occur since forward compatibility is limited."

func TestPrepareCompatibleUpgradeAllowsOnlySupportedRelease(t *testing.T) {
	client := &Client{}
	var constraints []string
	client.UpgradeCompatible = func(_ context.Context, target, constraint string) error {
		if target != "25.10.18" {
			t.Fatalf("upgrade target = %q", target)
		}
		constraints = append(constraints, constraint)
		return nil
	}

	retry, err := client.prepareCompatibleUpgrade(context.Background(), errors.New(newerPatchWarning+"\n'method'"))
	if err != nil || !retry {
		t.Fatalf("retry = %t, err = %v", retry, err)
	}
	if len(constraints) != 1 || constraints[0] != "25.10.*" {
		t.Fatalf("upgrade constraints = %#v", constraints)
	}

	// The successful target is remembered, so concurrent or repeated failed
	// reads do not reinstall the same compatibility update.
	retry, err = client.prepareCompatibleUpgrade(context.Background(), errors.New(newerPatchWarning))
	if err != nil || !retry || len(constraints) != 1 {
		t.Fatalf("second retry = %t, err = %v, constraints = %#v", retry, err, constraints)
	}
}

func TestPrepareCompatibleUpgradeRejectsAnotherRelease(t *testing.T) {
	client := &Client{UpgradeCompatible: func(context.Context, string, string) error {
		t.Fatal("cross-release update must not run")
		return nil
	}}
	cause := errors.New("The cloud `SimulationParam` (version: 25.11.2) is too new for your local schema package (version: 25.10.18).")
	retry, err := client.prepareCompatibleUpgrade(context.Background(), cause)
	if retry || CompatibilityErrorCode(err) != "flow360_release_not_supported" {
		t.Fatalf("retry = %t, err = %v, code = %q", retry, err, CompatibilityErrorCode(err))
	}
	if !strings.Contains(err.Error(), "Vibe Flow360") || strings.Contains(err.Error(), "method") {
		t.Fatalf("unexpected user-facing error: %v", err)
	}
}

func TestResourceSimulationDataUpgradesAndRetriesOnce(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	dir := t.TempDir()
	flowBinary := filepath.Join(dir, "flow360")
	pythonBinary := filepath.Join(dir, "python")
	attemptPath := filepath.Join(dir, "attempt")
	if err := os.WriteFile(flowBinary, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	script := `#!/bin/sh
if [ ! -f "` + attemptPath + `" ]; then
  printf '1' > "` + attemptPath + `"
  printf '%s\n' '` + newerPatchWarning + `' >&2
  printf '%s\n' "'method'" >&2
  exit 1
fi
printf '%s' '{"simulation_params":{"version":"25.10.18"},"summary":{"id":"geo-1"}}'
`
	if err := os.WriteFile(pythonBinary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	upgradeCalls := 0
	client := &Client{
		Binary:          flowBinary,
		ResourceTimeout: time.Second,
		UpgradeCompatible: func(_ context.Context, target, constraint string) error {
			upgradeCalls++
			if target != "25.10.18" {
				t.Fatalf("target = %q", target)
			}
			if constraint != SupportedVersionConstraint {
				t.Fatalf("constraint = %q", constraint)
			}
			return nil
		},
	}
	params, _, _, err := client.resourceSimulationData(context.Background(), "Geometry", "geo-1")
	if err != nil {
		t.Fatal(err)
	}
	if upgradeCalls != 1 || !strings.Contains(string(params), `"version":"25.10.18"`) {
		t.Fatalf("upgrade calls = %d, params = %s", upgradeCalls, params)
	}
}

func TestUpgradeManagedRuntimeStagesVerifiesAndAtomicallySwitches(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("managed runtime switching uses a POSIX symlink")
	}
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(binDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "uv-tools"), 0o700); err != nil {
		t.Fatal(err)
	}
	flowBinary := filepath.Join(binDir, "flow360")
	if err := os.WriteFile(flowBinary, []byte("#!/bin/sh\nprintf 'installed version: 25.10.17\\n'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	uvBinary := filepath.Join(binDir, "uv")
	uvScript := `#!/bin/sh
mkdir -p "$UV_TOOL_BIN_DIR"
printf '#!/bin/sh\nprintf "installed version: 25.10.18\\n"\n' > "$UV_TOOL_BIN_DIR/flow360"
chmod 700 "$UV_TOOL_BIN_DIR/flow360"
mkdir -p "$UV_TOOL_DIR/flow360/bin"
printf '#!/bin/sh\nprintf "25.10.18\\n"\n' > "$UV_TOOL_DIR/flow360/bin/python"
chmod 700 "$UV_TOOL_DIR/flow360/bin/python"
`
	if err := os.WriteFile(uvBinary, []byte(uvScript), 0o700); err != nil {
		t.Fatal(err)
	}
	client := &Client{Binary: flowBinary}
	if err := client.upgradeManagedRuntime(context.Background(), "25.10.18", SupportedVersionConstraint); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(flowBinary)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("activated Flow360 binary mode = %s, want symlink", info.Mode())
	}
	output, err := exec.Command(flowBinary, "version").CombinedOutput()
	if err != nil || !strings.Contains(string(output), "25.10.18") {
		t.Fatalf("activated runtime output = %q, err = %v", output, err)
	}
}

func TestUpgradeManagedRuntimeMigratesCustomInstallToManagedRuntime(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("managed runtime switching uses a POSIX symlink")
	}
	customRoot := t.TempDir()
	customBinDir := filepath.Join(customRoot, "bin")
	if err := os.MkdirAll(customBinDir, 0o700); err != nil {
		t.Fatal(err)
	}
	customBinary := filepath.Join(customBinDir, "flow360")
	if err := os.WriteFile(customBinary, []byte("#!/bin/sh\nprintf 'installed version: 25.10.17\\n'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	uvBinary := filepath.Join(customBinDir, "uv")
	uvScript := `#!/bin/sh
mkdir -p "$UV_TOOL_BIN_DIR"
printf '#!/bin/sh\nprintf "installed version: 25.10.18\\n"\n' > "$UV_TOOL_BIN_DIR/flow360"
chmod 700 "$UV_TOOL_BIN_DIR/flow360"
mkdir -p "$UV_TOOL_DIR/flow360/bin"
printf '#!/bin/sh\nprintf "25.10.18\\n"\n' > "$UV_TOOL_DIR/flow360/bin/python"
chmod 700 "$UV_TOOL_DIR/flow360/bin/python"
`
	if err := os.WriteFile(uvBinary, []byte(uvScript), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBESIM_UV_BINARY", uvBinary)
	managedRoot := t.TempDir()
	client := &Client{Binary: customBinary, ManagedRuntimeDir: managedRoot}
	if err := client.upgradeManagedRuntime(context.Background(), "25.10.18", SupportedVersionConstraint); err != nil {
		t.Fatal(err)
	}
	managedBinary := filepath.Join(managedRoot, "bin", "flow360")
	if client.runtimeBinary() != managedBinary {
		t.Fatalf("active binary = %q, want %q", client.runtimeBinary(), managedBinary)
	}
	info, err := os.Lstat(customBinary)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		t.Fatalf("custom runtime was replaced: mode=%v", info.Mode())
	}
	output, err := exec.Command(managedBinary, "version").CombinedOutput()
	if err != nil || !strings.Contains(string(output), "25.10.18") {
		t.Fatalf("managed runtime output = %q, err = %v", output, err)
	}
}
