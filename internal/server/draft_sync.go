package server

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
)

// syncDraftListSnapshot keeps the server-side fallback aligned with Flow360.
// If the canonical list cannot be read, the old snapshot is removed rather
// than allowing a successful mutation to be followed by stale local data.
func (s *Server) syncDraftListSnapshot(ctx context.Context, projectID string) {
	if s.cache == nil {
		return
	}
	projectID = strings.TrimSpace(projectID)
	if !validFlow360ProjectID(projectID) {
		if err := s.cache.DeleteKind("draft-list"); err != nil {
			log.Printf("Could not invalidate Flow360 Draft list snapshots: %v", err)
		}
		return
	}
	raw, err := s.flow360.ProjectDrafts(ctx, projectID)
	if err != nil || !cacheableSnapshot("draft-list", raw) {
		if deleteErr := s.cache.Delete("draft-list", projectID); deleteErr != nil {
			log.Printf("Could not invalidate Flow360 Draft list snapshot for %s: %v", projectID, deleteErr)
		}
		return
	}
	s.cacheLiveJSON("draft-list", projectID, raw)
}

func (s *Server) cacheConfiguredDraftDetail(detail flow360.ResourceDetail, canonical json.RawMessage) {
	if s.cache == nil {
		return
	}
	detail.SimulationParams = append(json.RawMessage(nil), canonical...)
	raw, err := json.Marshal(detail)
	if err != nil {
		return
	}
	s.cacheLiveJSON("resource-detail", "Draft/"+detail.ID, raw)
}

// syncCachedDraftParameters applies the value read back from Flow360 to any
// existing local detail snapshot. No synthetic partial snapshot is created.
func (s *Server) syncCachedDraftParameters(draftID string, canonical json.RawMessage) {
	if s.cache == nil {
		return
	}
	key := "Draft/" + strings.TrimSpace(draftID)
	entry, err := s.cache.Get("resource-detail", key)
	if err != nil {
		return
	}
	var detail map[string]any
	var params any
	if json.Unmarshal(entry.Data, &detail) != nil || json.Unmarshal(canonical, &params) != nil {
		_ = s.cache.Delete("resource-detail", key)
		return
	}
	detail["simulation_params"] = params
	raw, err := json.Marshal(detail)
	if err != nil {
		_ = s.cache.Delete("resource-detail", key)
		return
	}
	s.cacheLiveJSON("resource-detail", key, raw)
}

func (s *Server) syncCachedDraftName(draftID string, canonical json.RawMessage) {
	if s.cache == nil {
		return
	}
	key := "Draft/" + strings.TrimSpace(draftID)
	entry, err := s.cache.Get("resource-detail", key)
	if err != nil {
		return
	}
	var mutation map[string]any
	var detail map[string]any
	if json.Unmarshal(canonical, &mutation) != nil || json.Unmarshal(entry.Data, &detail) != nil {
		_ = s.cache.Delete("resource-detail", key)
		return
	}
	name, ok := mutation["name"].(string)
	if !ok || strings.TrimSpace(name) == "" {
		_ = s.cache.Delete("resource-detail", key)
		return
	}
	info, _ := detail["info"].(map[string]any)
	if info == nil {
		info = map[string]any{}
	}
	info["name"] = name
	detail["info"] = info
	raw, err := json.Marshal(detail)
	if err != nil {
		_ = s.cache.Delete("resource-detail", key)
		return
	}
	s.cacheLiveJSON("resource-detail", key, raw)
}

func (s *Server) deleteCachedDraftDetail(draftID string) {
	if s.cache == nil {
		return
	}
	if err := s.cache.Delete("resource-detail", "Draft/"+strings.TrimSpace(draftID)); err != nil {
		log.Printf("Could not invalidate Flow360 Draft detail snapshot %s: %v", draftID, err)
	}
}
