package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

type feature struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Owner string `json:"owner"`
}

type registry struct {
	Source struct {
		PackageVersion string `json:"package_version"`
		APIVersion     string `json:"api_version"`
	} `json:"source"`
	Features []feature `json:"features"`
}

type selector struct {
	Kinds          []string `yaml:"kinds"`
	Owners         []string `yaml:"owners"`
	OwnerPattern   string   `yaml:"owner_pattern"`
	FeaturePattern string   `yaml:"feature_pattern"`
}

type mapping struct {
	Selector selector `yaml:"selector"`
	Tutorial string   `yaml:"tutorial"`
	Section  string   `yaml:"section"`
	Status   string   `yaml:"status"`
	Artifact string   `yaml:"artifact"`
}

type exclusion struct {
	Selector selector `yaml:"selector"`
	Reason   string   `yaml:"reason"`
}

type coverage struct {
	Registry       string      `yaml:"registry"`
	PackageVersion string      `yaml:"package_version"`
	APIVersion     string      `yaml:"api_version"`
	Mappings       []mapping   `yaml:"mappings"`
	Exclusions     []exclusion `yaml:"exclusions"`
}

type compiledSelector struct {
	kinds   map[string]bool
	owners  map[string]bool
	owner   *regexp.Regexp
	feature *regexp.Regexp
}

func compileSelector(value selector) (compiledSelector, error) {
	result := compiledSelector{kinds: map[string]bool{}, owners: map[string]bool{}}
	for _, item := range value.Kinds {
		result.kinds[item] = true
	}
	for _, item := range value.Owners {
		result.owners[item] = true
	}
	var err error
	if value.OwnerPattern != "" {
		result.owner, err = regexp.Compile(value.OwnerPattern)
		if err != nil {
			return result, fmt.Errorf("owner_pattern: %w", err)
		}
	}
	if value.FeaturePattern != "" {
		result.feature, err = regexp.Compile(value.FeaturePattern)
		if err != nil {
			return result, fmt.Errorf("feature_pattern: %w", err)
		}
	}
	if len(result.kinds) == 0 && len(result.owners) == 0 && result.owner == nil && result.feature == nil {
		return result, errors.New("empty selector")
	}
	return result, nil
}

func (selector compiledSelector) matches(value feature) bool {
	if len(selector.kinds) > 0 && !selector.kinds[value.Kind] {
		return false
	}
	if len(selector.owners) > 0 && !selector.owners[value.Owner] {
		return false
	}
	if selector.owner != nil && !selector.owner.MatchString(value.Owner) {
		return false
	}
	return selector.feature == nil || selector.feature.MatchString(value.ID)
}

func read(path string, output any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if strings.HasSuffix(path, ".json") {
		return json.Unmarshal(data, output)
	}
	return yaml.Unmarshal(data, output)
}

func main() {
	root := flag.String("root", ".", "repository root")
	jsonOutput := flag.Bool("json", false, "print JSON report")
	flag.Parse()

	var manifest coverage
	if err := read(filepath.Join(*root, "tutorials", "coverage.yaml"), &manifest); err != nil {
		fatal(err)
	}
	var featureRegistry registry
	if err := read(filepath.Join(*root, manifest.Registry), &featureRegistry); err != nil {
		fatal(err)
	}
	if manifest.PackageVersion != featureRegistry.Source.PackageVersion || manifest.APIVersion != featureRegistry.Source.APIVersion {
		fatal(fmt.Errorf("coverage target %s/%s does not match registry %s/%s", manifest.APIVersion, manifest.PackageVersion, featureRegistry.Source.APIVersion, featureRegistry.Source.PackageVersion))
	}

	type compiledMapping struct {
		mapping
		selector compiledSelector
	}
	type compiledExclusion struct {
		exclusion
		selector compiledSelector
	}
	mappings := make([]compiledMapping, len(manifest.Mappings))
	for index, value := range manifest.Mappings {
		if value.Tutorial == "" || (value.Status != "planned" && value.Status != "verified") {
			fatal(fmt.Errorf("mapping %d has invalid tutorial/status", index))
		}
		compiled, err := compileSelector(value.Selector)
		if err != nil {
			fatal(fmt.Errorf("mapping %d: %w", index, err))
		}
		mappings[index] = compiledMapping{mapping: value, selector: compiled}
	}
	exclusions := make([]compiledExclusion, len(manifest.Exclusions))
	for index, value := range manifest.Exclusions {
		if value.Reason == "" {
			fatal(fmt.Errorf("exclusion %d has no reason", index))
		}
		compiled, err := compileSelector(value.Selector)
		if err != nil {
			fatal(fmt.Errorf("exclusion %d: %w", index, err))
		}
		exclusions[index] = compiledExclusion{exclusion: value, selector: compiled}
	}

	report := map[string][]string{"covered": {}, "verified": {}, "missing": {}, "excluded": {}}
	mappingHits := make([]int, len(mappings))
	exclusionHits := make([]int, len(exclusions))
	for _, current := range featureRegistry.Features {
		excluded := 0
		for index, rule := range exclusions {
			if rule.selector.matches(current) {
				excluded++
				exclusionHits[index]++
			}
		}
		matched := []mapping{}
		for index, rule := range mappings {
			if rule.selector.matches(current) {
				matched = append(matched, rule.mapping)
				mappingHits[index]++
			}
		}
		if len(matched) > 1 {
			fatal(fmt.Errorf("feature %s matches multiple mappings", current.ID))
		}
		if excluded > 0 {
			report["excluded"] = append(report["excluded"], current.ID)
			continue
		}
		if len(matched) == 0 {
			report["missing"] = append(report["missing"], current.ID)
			continue
		}
		if matched[0].Status == "verified" {
			if matched[0].Artifact == "" {
				fatal(fmt.Errorf("verified feature %s has no artifact", current.ID))
			}
			if _, err := os.Stat(filepath.Join(*root, matched[0].Artifact)); err != nil {
				fatal(fmt.Errorf("verified feature %s: %w", current.ID, err))
			}
			report["verified"] = append(report["verified"], current.ID)
		} else {
			report["covered"] = append(report["covered"], current.ID)
		}
	}
	for index, hits := range mappingHits {
		if hits == 0 {
			fatal(fmt.Errorf("mapping %d does not match any registry feature", index))
		}
	}
	for index, hits := range exclusionHits {
		if hits == 0 {
			fatal(fmt.Errorf("exclusion %d does not match any registry feature", index))
		}
	}
	for _, values := range report {
		sort.Strings(values)
	}
	if *jsonOutput {
		data, _ := json.MarshalIndent(report, "", "  ")
		fmt.Println(string(data))
	} else {
		fmt.Printf("Flow360 tutorials coverage (%s / %s)\n", featureRegistry.Source.APIVersion, featureRegistry.Source.PackageVersion)
		fmt.Printf("covered=%d verified=%d missing=%d excluded=%d total=%d\n", len(report["covered"]), len(report["verified"]), len(report["missing"]), len(report["excluded"]), len(featureRegistry.Features))
		for _, id := range report["missing"] {
			fmt.Printf("MISSING %s\n", id)
		}
	}
	if len(report["missing"]) > 0 {
		os.Exit(1)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "tutorial coverage:", err)
	os.Exit(2)
}
