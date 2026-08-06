package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDotEnvDoesNotOverrideProcessEnvironment(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("EXISTING=from-file\nNEW_VALUE=\"from env file\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EXISTING", "from-process")
	_ = os.Unsetenv("NEW_VALUE")
	t.Cleanup(func() { _ = os.Unsetenv("NEW_VALUE") })

	if err := LoadDotEnv(path); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("EXISTING"); got != "from-process" {
		t.Fatalf("existing value was overwritten: %q", got)
	}
	if got := os.Getenv("NEW_VALUE"); got != "from env file" {
		t.Fatalf("new value was not loaded: %q", got)
	}
}

func TestUpdateDotEnvPreservesUnmanagedEntriesAndQuotesValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	original := "# user comment\nUNMANAGED=keep\nVIBESIM_FLOW360_PROFILE=old\n"
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}

	err := UpdateDotEnv(path, map[string]string{
		"VIBESIM_FLOW360_PROFILE": "research profile",
		"VIBESIM_FLOW360_BINARY":  "/tmp/tools with spaces/flow360",
	})
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	for _, expected := range []string{
		"# user comment",
		"UNMANAGED=keep",
		`VIBESIM_FLOW360_PROFILE="research profile"`,
		`VIBESIM_FLOW360_BINARY="/tmp/tools with spaces/flow360"`,
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("updated dotenv is missing %q:\n%s", expected, text)
		}
	}
	values, err := ReadDotEnv(path)
	if err != nil {
		t.Fatal(err)
	}
	if values["VIBESIM_FLOW360_BINARY"] != "/tmp/tools with spaces/flow360" {
		t.Fatalf("quoted path did not round-trip: %#v", values)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("dotenv permissions = %o, want 600", info.Mode().Perm())
	}
}
