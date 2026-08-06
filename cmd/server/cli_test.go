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
