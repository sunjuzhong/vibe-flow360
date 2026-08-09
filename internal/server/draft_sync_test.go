package server

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/projectcache"
)

func TestDraftMutationSnapshotsUseCanonicalCloudValues(t *testing.T) {
	cache, err := projectcache.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cache.Put("resource-detail", "Draft/draft-1", json.RawMessage(`{
		"id":"draft-1","type":"Draft","info":{"name":"Old name"},
		"simulation_params":{"version":"old"}
	}`)); err != nil {
		t.Fatal(err)
	}
	app := &Server{cache: cache}

	app.syncCachedDraftName("draft-1", json.RawMessage(`{"id":"draft-1","name":"Canonical name"}`))
	app.syncCachedDraftParameters("draft-1", json.RawMessage(`{"version":"canonical"}`))

	entry, err := cache.Get("resource-detail", "Draft/draft-1")
	if err != nil {
		t.Fatal(err)
	}
	var detail struct {
		Info             map[string]any `json:"info"`
		SimulationParams map[string]any `json:"simulation_params"`
	}
	if err := json.Unmarshal(entry.Data, &detail); err != nil {
		t.Fatal(err)
	}
	if detail.Info["name"] != "Canonical name" || detail.SimulationParams["version"] != "canonical" {
		t.Fatalf("local Draft snapshot did not use canonical cloud values: %s", entry.Data)
	}

	app.deleteCachedDraftDetail("draft-1")
	if _, err := cache.Get("resource-detail", "Draft/draft-1"); err == nil {
		t.Fatal("deleted Draft detail remained in the local cache")
	}
}

func TestSyncDraftListSnapshotRefreshesFromFlow360(t *testing.T) {
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "flow360")
	if err := os.WriteFile(binaryPath, []byte(`#!/bin/sh
printf '{"records":[{"id":"draft-cloud","name":"Cloud Draft"}]}'
`), 0o700); err != nil {
		t.Fatal(err)
	}
	cache, err := projectcache.New(filepath.Join(dir, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cache.Put("draft-list", "prj-1", json.RawMessage(`{"records":[{"id":"draft-stale"}]}`)); err != nil {
		t.Fatal(err)
	}
	app := &Server{
		cache:   cache,
		flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second},
	}

	app.syncDraftListSnapshot(context.Background(), "prj-1")

	entry, err := cache.Get("draft-list", "prj-1")
	if err != nil {
		t.Fatal(err)
	}
	var listing struct {
		Records []map[string]any `json:"records"`
	}
	if json.Unmarshal(entry.Data, &listing) != nil || len(listing.Records) != 1 || listing.Records[0]["id"] != "draft-cloud" {
		t.Fatalf("Draft list cache was not refreshed from Flow360: %s", entry.Data)
	}
}

func TestSyncDraftListSnapshotDropsStaleCacheWhenCloudReadbackFails(t *testing.T) {
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "flow360")
	if err := os.WriteFile(binaryPath, []byte("#!/bin/sh\nexit 1\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	cache, err := projectcache.New(filepath.Join(dir, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cache.Put("draft-list", "prj-1", json.RawMessage(`{"records":[{"id":"draft-stale"}]}`)); err != nil {
		t.Fatal(err)
	}
	app := &Server{cache: cache, flow360: &flow360.Client{Binary: binaryPath, Timeout: time.Second}}

	app.syncDraftListSnapshot(context.Background(), "prj-1")

	if _, err := cache.Get("draft-list", "prj-1"); err == nil {
		t.Fatal("stale Draft list remained available after cloud readback failed")
	}
}
