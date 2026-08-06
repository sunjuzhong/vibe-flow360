package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunCLIWithoutCommandShowsNewCommands(t *testing.T) {
	var output bytes.Buffer
	if err := runCLI(nil, strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"vibe-flow360 init", "vibe-flow360 serve"} {
		if !strings.Contains(output.String(), expected) {
			t.Fatalf("usage is missing %q:\n%s", expected, output.String())
		}
	}
}

func TestServerURL(t *testing.T) {
	for input, want := range map[string]string{
		":9292":          "http://localhost:9292",
		"127.0.0.1:9292": "http://127.0.0.1:9292",
		"https://host":   "https://host",
	} {
		if got := serverURL(input); got != want {
			t.Errorf("serverURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestInitHelpExplainsAuthenticationSkipIsForAutomation(t *testing.T) {
	var output bytes.Buffer
	if err := runCLI([]string{"init", "--help"}, strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "skip-auth-check") || !strings.Contains(output.String(), "CI/image builds only") {
		t.Fatalf("init help does not constrain authentication skipping:\n%s", output.String())
	}
}

func TestVersionReportsInjectedBuildVersion(t *testing.T) {
	previous := buildVersion
	buildVersion = "25.10.3"
	t.Cleanup(func() { buildVersion = previous })

	var output bytes.Buffer
	if err := runCLI([]string{"version"}, strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(output.String()); got != "vibe-flow360 25.10.3" {
		t.Fatalf("version output = %q", got)
	}
}

func TestVersionRejectsArguments(t *testing.T) {
	err := runCLI([]string{"version", "unexpected"}, strings.NewReader(""), &bytes.Buffer{}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "does not accept") {
		t.Fatalf("version argument error = %v", err)
	}
}
