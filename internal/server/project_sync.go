package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
	"github.com/sunjuzhong/vibe-flow360/internal/projectmirror"
)

const projectSyncWorkerCount = 3

type projectSyncClient interface {
	ProjectInfo(context.Context, string) (json.RawMessage, error)
	ProjectTree(context.Context, string) (json.RawMessage, error)
	ProjectItems(context.Context, string) (json.RawMessage, error)
	ResourceDetail(context.Context, string, string) (flow360.ResourceDetail, error)
	GeometryVisualization(context.Context, string) (flow360.GeometryVisualization, error)
}

type projectSyncItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

func (s *Server) startProjectSync(c *gin.Context) {
	projectID := strings.TrimSpace(c.Param("project_id"))
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_id is required"})
		return
	}
	if s.mirror == nil || s.projectSyncClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "project synchronization is unavailable"})
		return
	}

	s.projectSyncMu.Lock()
	if s.projectSyncJobs == nil {
		s.projectSyncJobs = map[string]struct{}{}
	}
	if _, running := s.projectSyncJobs[projectID]; running {
		s.projectSyncMu.Unlock()
		s.writeProjectSyncManifest(c, http.StatusAccepted, projectID)
		return
	}
	manifest := projectmirror.NewManifest(projectID, s.mirror.Namespace())
	if err := s.mirror.PutManifest(manifest); err != nil {
		s.projectSyncMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	s.projectSyncJobs[projectID] = struct{}{}
	s.projectSyncMu.Unlock()
	manifest, _ = s.mirror.GetManifest(projectID)

	go func() {
		s.syncProject(context.Background(), projectID, s.projectSyncClient)
		s.projectSyncMu.Lock()
		delete(s.projectSyncJobs, projectID)
		s.projectSyncMu.Unlock()
	}()
	c.JSON(http.StatusAccepted, manifest)
}

func (s *Server) projectSyncStatus(c *gin.Context) {
	projectID := strings.TrimSpace(c.Param("project_id"))
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_id is required"})
		return
	}
	s.writeProjectSyncManifest(c, http.StatusOK, projectID)
}

func (s *Server) writeProjectSyncManifest(c *gin.Context, status int, projectID string) {
	if s.mirror == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "project synchronization is unavailable"})
		return
	}
	manifest, err := s.mirror.GetManifest(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project synchronization has not started"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(status, manifest)
}

func (s *Server) syncProject(ctx context.Context, projectID string, client projectSyncClient) projectmirror.Manifest {
	manifest := projectmirror.NewManifest(projectID, s.mirror.Namespace())
	manifest.LocalPath, _ = s.mirror.ProjectDir(projectID)
	var manifestMu sync.Mutex

	persist := func() {
		manifest.UpdatedAt = time.Now().UTC()
		if err := s.mirror.PutManifest(manifest); err != nil {
			manifest.Failures["manifest"] = "could not persist synchronization progress"
		}
	}
	failSection := func(section string, err error) {
		manifest.Failures[section] = err.Error()
	}

	type projectSection struct {
		kind string
		load func(context.Context, string) (json.RawMessage, error)
	}
	sections := []projectSection{
		{kind: "project-info", load: client.ProjectInfo},
		{kind: "project-tree", load: client.ProjectTree},
		{kind: "project-items", load: client.ProjectItems},
	}
	var itemsRaw json.RawMessage
	for _, section := range sections {
		raw, err := section.load(ctx, projectID)
		if err != nil {
			failSection(section.kind, err)
			persist()
			continue
		}
		if !cacheableSnapshot(section.kind, raw) {
			failSection(section.kind, fmt.Errorf("Flow360 returned an incomplete %s snapshot", section.kind))
			persist()
			continue
		}
		if err := s.mirror.PutProjectData(projectID, section.kind, raw); err != nil {
			failSection(section.kind, err)
			persist()
			continue
		}
		s.cacheLiveJSON(section.kind, projectID, raw)
		if section.kind == "project-items" {
			itemsRaw = raw
		}
		persist()
	}

	var itemList struct {
		Items []projectSyncItem `json:"items"`
	}
	if len(itemsRaw) == 0 {
		manifest.Status = projectmirror.StatusFailed
		completedAt := time.Now().UTC()
		manifest.CompletedAt = &completedAt
		persist()
		return manifest
	}
	if err := json.Unmarshal(itemsRaw, &itemList); err != nil {
		failSection("project-items", err)
		manifest.Status = projectmirror.StatusFailed
		completedAt := time.Now().UTC()
		manifest.CompletedAt = &completedAt
		persist()
		return manifest
	}

	manifest.TotalResources = len(itemList.Items)
	for _, item := range itemList.Items {
		key := item.Type + "/" + item.ID
		manifest.Resources[key] = projectmirror.ResourceStatus{
			ID:     item.ID,
			Type:   item.Type,
			Status: "pending",
		}
	}
	persist()

	jobs := make(chan projectSyncItem)
	var workers sync.WaitGroup
	workerCount := projectSyncWorkerCount
	if len(itemList.Items) < workerCount {
		workerCount = len(itemList.Items)
	}
	for index := 0; index < workerCount; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for item := range jobs {
				key := item.Type + "/" + item.ID
				manifestMu.Lock()
				manifest.CurrentResource = key
				status := manifest.Resources[key]
				status.Status = "syncing"
				manifest.Resources[key] = status
				persist()
				manifestMu.Unlock()

				detail, err := client.ResourceDetail(ctx, item.Type, item.ID)
				if err == nil && len(detail.Errors) > 0 {
					keys := make([]string, 0, len(detail.Errors))
					for operation := range detail.Errors {
						keys = append(keys, operation)
					}
					sort.Strings(keys)
					err = fmt.Errorf("partial Flow360 detail: %s", strings.Join(keys, ", "))
				}
				var raw json.RawMessage
				var visualization flow360.GeometryVisualization
				if err == nil {
					raw, err = json.Marshal(detail)
				}
				if err == nil && item.Type == "Geometry" {
					visualization, err = client.GeometryVisualization(ctx, item.ID)
				}
				var artifacts map[string]projectmirror.ArtifactStatus
				if err == nil && item.Type == "Geometry" {
					artifacts, err = s.mirror.PutGeometryVisualization(
						projectID,
						item.ID,
						visualization.Manifest,
						visualization.Bins,
					)
				}
				if err == nil {
					err = s.mirror.PutResource(projectID, item.Type, item.ID, raw)
				}
				if err == nil {
					s.cacheLiveJSON("resource-detail", key, raw)
				}

				manifestMu.Lock()
				status = manifest.Resources[key]
				if err != nil {
					status.Status = "failed"
					status.Error = err.Error()
					manifest.Failures[key] = err.Error()
					manifest.FailedResources++
				} else {
					status.Status = "completed"
					status.Artifacts = artifacts
					status.SyncedAt = time.Now().UTC()
					manifest.SyncedResources++
				}
				manifest.Resources[key] = status
				persist()
				manifestMu.Unlock()
			}
		}()
	}
	for _, item := range itemList.Items {
		jobs <- item
	}
	close(jobs)
	workers.Wait()

	manifestMu.Lock()
	manifest.CurrentResource = ""
	completedAt := time.Now().UTC()
	manifest.CompletedAt = &completedAt
	switch {
	case len(manifest.Failures) == 0:
		manifest.Status = projectmirror.StatusCompleted
	case manifest.SyncedResources == 0:
		manifest.Status = projectmirror.StatusFailed
	default:
		manifest.Status = projectmirror.StatusPartial
	}
	persist()
	manifestMu.Unlock()
	return manifest
}
