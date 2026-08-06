package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// LoadDotEnv loads simple KEY=VALUE entries without overriding variables that
// are already present in the process environment.
func LoadDotEnv(path string) error {
	values, err := ReadDotEnv(path)
	if err != nil {
		return err
	}
	for key, value := range values {
		if _, exists := os.LookupEnv(key); !exists {
			if err := os.Setenv(key, value); err != nil {
				return fmt.Errorf("set %s from %s: %w", key, path, err)
			}
		}
	}
	return nil
}

// ReadDotEnv parses a dotenv file without modifying the process environment.
func ReadDotEnv(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	defer file.Close()

	values := make(map[string]string)
	scanner := bufio.NewScanner(file)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		key, value, ok, err := parseDotEnvLine(scanner.Text())
		if err != nil {
			return nil, fmt.Errorf("%s:%d: %w", path, lineNumber, err)
		}
		if ok {
			values[key] = value
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return values, nil
}

// UpdateDotEnv merges values into a dotenv file. Existing comments, ordering,
// and unmanaged entries are preserved. The file is written atomically with
// owner-only permissions because it may contain credentials.
func UpdateDotEnv(path string, updates map[string]string) error {
	content, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	seen := make(map[string]bool)
	lines := strings.Split(strings.TrimSuffix(string(content), "\n"), "\n")
	if len(content) == 0 {
		lines = nil
	}
	for index, line := range lines {
		key, _, ok, parseErr := parseDotEnvLine(line)
		if parseErr != nil {
			return fmt.Errorf("%s:%d: %w", path, index+1, parseErr)
		}
		value, managed := updates[key]
		if ok && managed {
			lines[index] = key + "=" + encodeDotEnvValue(value)
			seen[key] = true
		}
	}

	appendedHeader := false
	for _, key := range sortedKeys(updates) {
		if seen[key] {
			continue
		}
		if !appendedHeader && len(lines) > 0 {
			lines = append(lines, "", "# Managed by vibe-flow360 init.")
			appendedHeader = true
		}
		lines = append(lines, key+"="+encodeDotEnvValue(updates[key]))
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".env-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.WriteString(strings.Join(lines, "\n") + "\n"); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func parseDotEnvLine(raw string) (key, value string, ok bool, err error) {
	line := strings.TrimSpace(raw)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false, nil
	}
	line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
	key, value, found := strings.Cut(line, "=")
	if !found {
		return "", "", false, errors.New("expected KEY=VALUE")
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return "", "", false, errors.New("environment key is empty")
	}
	value = strings.TrimSpace(value)
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		unquoted, unquoteErr := strconv.Unquote(value)
		if unquoteErr != nil {
			return "", "", false, fmt.Errorf("invalid quoted value: %w", unquoteErr)
		}
		value = unquoted
	} else if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
		value = value[1 : len(value)-1]
	}
	return key, value, true, nil
}

func encodeDotEnvValue(value string) string {
	if value == "" {
		return ""
	}
	if strings.ContainsAny(value, " \t\r\n#\"'") {
		return strconv.Quote(value)
	}
	return value
}

func sortedKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}
