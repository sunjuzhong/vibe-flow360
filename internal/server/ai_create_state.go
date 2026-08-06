package server

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"time"
)

const aiCreateStateDirectory = "ai-create-state"

func (s *Server) aiCreateStatePath(name string) string {
	if s.workDir == "" {
		return ""
	}
	return filepath.Join(s.workDir, aiCreateStateDirectory, name+".json")
}

func writeAICreateState(path string, value any) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".state-*.json")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
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
	return os.Rename(temporaryName, path)
}

func readAICreateState(path string, value any) error {
	payload, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(payload, value)
}

func (s *Server) persistAICreateSessionsLocked() {
	if err := writeAICreateState(s.aiCreateStatePath("sessions"), s.aiCreateSessions); err != nil {
		log.Printf("Could not persist AI Create sessions: %v", err)
	}
}

func (s *Server) persistAICreateProgressLocked() {
	if err := writeAICreateState(s.aiCreateStatePath("progress"), s.aiCreateProgress); err != nil {
		log.Printf("Could not persist AI Create progress: %v", err)
	}
}

func (s *Server) loadAICreateState() {
	sessions := map[string]aiCreateSession{}
	if err := readAICreateState(s.aiCreateStatePath("sessions"), &sessions); err != nil && !os.IsNotExist(err) {
		log.Printf("Could not restore AI Create sessions: %v", err)
	}
	progress := map[string]aiCreateProgress{}
	if err := readAICreateState(s.aiCreateStatePath("progress"), &progress); err != nil && !os.IsNotExist(err) {
		log.Printf("Could not restore AI Create progress: %v", err)
	}
	now := time.Now().UTC()
	for id, item := range progress {
		if now.Sub(item.UpdatedAt) > aiCreateProgressTTL {
			delete(progress, id)
			continue
		}
		if item.Status == "running" {
			item.Status = "recovering"
			item.Detail = "The local backend restarted. AI Create will resume from the persisted Project and Geometry without creating a duplicate."
			item.UpdatedAt = now
			progress[id] = item
		}
	}
	s.aiCreateSessions = sessions
	s.aiCreateProgress = progress
	s.persistAICreateProgressLocked()
}
