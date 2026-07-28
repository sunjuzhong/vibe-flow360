package flow360

import (
	"strings"
	"testing"
)

func TestFirstMeaningfulLinePrefersInstalledVersion(t *testing.T) {
	output := []byte("Solver Version  Installed\nInstalled version: 25.7.6b0\n")
	if got := firstMeaningfulLine(output); got != "Installed version: 25.7.6b0" {
		t.Fatalf("unexpected version: %q", got)
	}
}

func TestCommandArgsPutGlobalOptionsBeforeSubcommand(t *testing.T) {
	client := &Client{Profile: "secondary", Environment: "uat"}
	got := client.commandArgs("project", "list")
	want := []string{"--profile", "secondary", "--uat", "project", "list"}
	if len(got) != len(want) {
		t.Fatalf("unexpected arguments: %#v", got)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("argument %d: got %q, want %q", index, got[index], want[index])
		}
	}
}

func TestCommandArgsSupportNamedEnvironment(t *testing.T) {
	client := &Client{Profile: "default", Environment: "staging"}
	got := client.commandArgs("version")
	if len(got) < 5 || got[2] != "--env" || got[3] != "staging" {
		t.Fatalf("unexpected named-environment arguments: %#v", got)
	}
}

func TestExtractJSONAllowsFlow360LogPrefix(t *testing.T) {
	output := []byte("[13:48:23] INFO: Found env variable FLOW360_APIKEY\n{\"root\":{\"id\":\"ROOT.FLOW360\"}}\n")
	raw, err := extractJSON(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "ROOT.FLOW360") {
		t.Fatalf("unexpected JSON: %s", raw)
	}
}

func TestResourceCommandNormalizesTypes(t *testing.T) {
	tests := map[string]string{
		"Geometry":    "geometry",
		"SurfaceMesh": "surface-mesh",
		"volume-mesh": "volume-mesh",
		"Case":        "case",
	}
	for input, expected := range tests {
		command, _, err := resourceCommand(input)
		if err != nil {
			t.Fatalf("%s: %v", input, err)
		}
		if command != expected {
			t.Fatalf("%s: got %q, want %q", input, command, expected)
		}
	}
}
