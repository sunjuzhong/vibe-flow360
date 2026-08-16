package agentskills

import (
	"embed"
	"fmt"
	"path"
	"sort"
	"strings"
)

type Stage string

const (
	CatalogVersion           = "2026-08-16.1"
	CADDesign          Stage = "cad-design"
	ParameterAuthoring Stage = "parameter-authoring"
	PreflightRepair    Stage = "preflight-repair"
)

//go:embed skills/*/SKILL.md
var skillFiles embed.FS

var stageSkills = map[Stage][]string{
	CADDesign:          {"flow360-cad-design", "flow360-external-aero-cad"},
	ParameterAuthoring: {"flow360-parameter-authoring"},
	PreflightRepair:    {"flow360-parameter-authoring", "flow360-preflight-repair"},
}

// Instructions returns the concise, stage-scoped product skills injected into
// an Agent call. Live Flow360 schemas and entity evidence remain authoritative.
func Instructions(stage Stage) string {
	names := append([]string(nil), stageSkills[stage]...)
	if len(names) == 0 {
		return ""
	}
	var sections []string
	for _, name := range names {
		contents, err := skillFiles.ReadFile(path.Join("skills", name, "SKILL.md"))
		if err != nil {
			continue
		}
		body := skillBody(string(contents))
		if body != "" {
			sections = append(sections, fmt.Sprintf("## Skill: %s\n%s", name, body))
		}
	}
	if len(sections) == 0 {
		return ""
	}
	return fmt.Sprintf("# Vibe Flow360 runtime skills\nCatalog: %s\nStage: %s\n\n%s", CatalogVersion, stage, strings.Join(sections, "\n\n"))
}

func Names(stage Stage) []string {
	names := append([]string(nil), stageSkills[stage]...)
	sort.Strings(names)
	return names
}

func skillBody(contents string) string {
	contents = strings.TrimSpace(contents)
	if !strings.HasPrefix(contents, "---\n") {
		return contents
	}
	remaining := strings.TrimPrefix(contents, "---\n")
	index := strings.Index(remaining, "\n---\n")
	if index < 0 {
		return ""
	}
	return strings.TrimSpace(remaining[index+5:])
}
