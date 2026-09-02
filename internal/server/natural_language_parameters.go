package server

import (
	"encoding/json"
	"strings"
)

// naturalLanguageParameterMapping grounds common engineering shorthand in the
// installed Flow360 schema. These entries do not bypass schema validation or
// manufacture patches; they disambiguate user language before the Agent emits
// the same bounded operations used by every other parameter edit.
type naturalLanguageParameterMapping struct {
	Name          string
	Aliases       []string
	SuppressWhen  []string
	SchemaPaths   []string
	CanonicalTerm string
	Guidance      string
}

var naturalLanguageParameterMappings = []naturalLanguageParameterMapping{
	{
		Name:         "case CFL",
		Aliases:      []string{"cfl", "courant number", "courant", "库朗数"},
		SuppressWhen: []string{"cfl multiplier", "cfl系数", "cfl 系数", "cfl倍数", "cfl 倍数"},
		SchemaPaths:  []string{"time_stepping.CFL"},
		Guidance:     "Treat an unqualified CFL request as the case time-stepping CFL, not a fluid-solver CFL_multiplier. Use the exact scalar or adaptive-CFL representation exposed by the active schema.",
	},
	{
		Name:        "fluid solver CFL multiplier",
		Aliases:     []string{"cfl multiplier", "cfl系数", "cfl 系数", "cfl倍数", "cfl 倍数"},
		SchemaPaths: []string{"models[*].navier_stokes_solver.CFL_multiplier"},
		Guidance:    "Change only the matching Fluid model solver multiplier unless the request explicitly names another solver.",
	},
	{
		Name:          "k-omega SST turbulence model",
		Aliases:       []string{"k-omega", "k omega", "komega", "k-ω", "kω", "k-omega sst", "sst turbulence", "sst湍流", "sst 湍流"},
		SchemaPaths:   []string{"models[*].turbulence_model_solver", "models[*].turbulence_quantities"},
		CanonicalTerm: "kOmegaSST",
		Guidance:      "Select the schema's kOmegaSST model variant and include its schema-required defaults. Update compatible freestream turbulence quantities only when the active schema and existing boundary model require them.",
	},
	{
		Name:          "Spalart-Allmaras turbulence model",
		Aliases:       []string{"spalart-allmaras", "spalart allmaras", "sa turbulence", "sa湍流", "sa 湍流", "sa模型", "sa 模型"},
		SchemaPaths:   []string{"models[*].turbulence_model_solver", "models[*].turbulence_quantities"},
		CanonicalTerm: "SpalartAllmaras",
		Guidance:      "Select the schema's SpalartAllmaras model variant and include its schema-required defaults. Preserve unrelated Fluid-model settings.",
	},
	{
		Name:        "maximum solver steps",
		Aliases:     []string{"max steps", "maximum steps", "最大步数", "迭代步数", "最大迭代数"},
		SchemaPaths: []string{"time_stepping.max_steps"},
		Guidance:    "Map the requested integer to the case time-stepping maximum step count.",
	},
}

type naturalLanguageParameterHint struct {
	Concept       string   `json:"concept"`
	MatchedAlias  string   `json:"matched_alias"`
	SchemaPaths   []string `json:"schema_paths"`
	CanonicalTerm string   `json:"canonical_term,omitempty"`
	Guidance      string   `json:"guidance"`
}

func planAssistNaturalLanguageHints(prompt string) string {
	normalized := normalizeParameterIntent(prompt)
	if normalized == "" {
		return ""
	}
	hints := make([]naturalLanguageParameterHint, 0, 3)
	for _, mapping := range naturalLanguageParameterMappings {
		if matchesParameterAlias(normalized, mapping.SuppressWhen) != "" {
			continue
		}
		matched := matchesParameterAlias(normalized, mapping.Aliases)
		if matched == "" {
			continue
		}
		hints = append(hints, naturalLanguageParameterHint{
			Concept: mapping.Name, MatchedAlias: matched, SchemaPaths: mapping.SchemaPaths,
			CanonicalTerm: mapping.CanonicalTerm, Guidance: mapping.Guidance,
		})
	}
	if len(hints) == 0 {
		return ""
	}
	payload, err := json.Marshal(hints)
	if err != nil {
		return ""
	}
	return `

## Matched natural-language parameter mappings

The following aliases matched the user's instruction. Treat them as semantic lookup hints only: verify every target and value against form_schema, preserve unrelated baseline values, and emit bounded path-level operations. If a hinted path is unavailable or ambiguous in the active schema, ask a focused question instead of inventing a nearby field.
` + string(payload)
}

func matchesParameterAlias(normalized string, aliases []string) string {
	for _, alias := range aliases {
		if strings.Contains(normalized, normalizeParameterIntent(alias)) {
			return alias
		}
	}
	return ""
}

func normalizeParameterIntent(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"_", " ", "–", "-", "—", "-", "−", "-", "ω", "omega", "Ω", "omega",
		"\t", " ", "\n", " ", "\r", " ",
	)
	return strings.Join(strings.Fields(replacer.Replace(value)), " ")
}
