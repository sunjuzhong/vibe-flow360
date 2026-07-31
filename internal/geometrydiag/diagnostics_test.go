package geometrydiag

import (
	"encoding/json"
	"testing"
)

func manifest(faceEntries string, positionLength int, maxX float64) json.RawMessage {
	return json.RawMessage(`[{"id":"solid","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[` + number(maxX) + `,2,3]},"resources":{"buffers":{"type":"buffers","sections":[{"name":"position","length":` + number(float64(positionLength)) + `}]}}},` + faceEntries + `]`)
}

func number(value float64) string {
	payload, _ := json.Marshal(value)
	return string(payload)
}

func TestAnalyzeKeepsProxyAndUnavailableCapabilitiesExplicit(t *testing.T) {
	raw := manifest(`
		{"id":"body00001_face_0","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}},
		{"id":"body00001_face_1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":3,"endIndex":33}]}}}`, 144, 1)
	report, err := Analyze("geo-1", raw, Settings{SmallSurfaceRatio: 0.2})
	if err != nil {
		t.Fatal(err)
	}
	if report.Capabilities[0].Status != "proxy" || report.Capabilities[1].Status != "unavailable" {
		t.Fatalf("unsupported capability was overstated: %#v", report.Capabilities)
	}
	if len(report.Findings) != 4 || len(report.Findings[0].EntityIDs) != 1 {
		t.Fatalf("unexpected findings: %#v", report.Findings)
	}
	if len(report.Groupings) != 1 || len(report.Groupings[0].EntityIDs) != 2 {
		t.Fatalf("unexpected grouping proposals: %#v", report.Groupings)
	}
}

func TestCompareReportsTopologyAndBoundsChanges(t *testing.T) {
	baseline := manifest(`{"id":"wing","name":"wing","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}}`, 36, 1)
	candidate := manifest(`
		{"id":"wing","name":"wing","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":6}]} }},
		{"id":"tail","name":"tail","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":6,"endIndex":9}]}}}`, 72, 2)
	comparison, err := Compare("geo-a", baseline, "geo-b", candidate)
	if err != nil {
		t.Fatal(err)
	}
	if comparison.Metrics[0].Delta != 1 || comparison.Metrics[1].Delta != 3 {
		t.Fatalf("unexpected metrics: %#v", comparison.Metrics)
	}
	if len(comparison.AddedSurfaces) != 1 || comparison.AddedSurfaces[0] != "tail" {
		t.Fatalf("unexpected surface diff: %#v", comparison)
	}
}

func TestAnalyzeUsesProvidedFaceAreaAndSolidBoundsWhenAvailable(t *testing.T) {
	raw := json.RawMessage(`[
		{"id":"body00001","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[1,1,1]},"resources":{"buffers":{"type":"buffers","sections":[{"name":"position","length":36}]}}},
		{"id":"body00002","type":"SolidGeometry","properties":{"boundsMin":[2,0,0],"boundsMax":[3,1,1]},"resources":{"buffers":{"type":"buffers","sections":[{"name":"position","length":36}]}}},
		{"id":"body00001_face00001","name":"body00001_face_0","type":"Face","attributions":{"packedParentId":"body00001"},"properties":{"area":0.01,"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}},
		{"id":"body00001_face00002","name":"body00001_face_1","type":"Face","attributions":{"packedParentId":"body00001"},"properties":{"area":10,"bufferLocations":{"indices":[{"startIndex":3,"endIndex":33}]}}},
		{"id":"body00002_face00001","name":"body00002_face_0","type":"Face","attributions":{"packedParentId":"body00002"},"properties":{"area":10,"bufferLocations":{"indices":[{"startIndex":0,"endIndex":30}]}}}
	]`)
	report, err := Analyze("geo-areas", raw, Settings{SmallSurfaceRatio: 0.1})
	if err != nil {
		t.Fatal(err)
	}
	if report.Capabilities[0].Status != "available" || report.Capabilities[1].Status != "proxy" {
		t.Fatalf("unexpected capabilities: %#v", report.Capabilities)
	}
	if report.Findings[0].Title != "Small-area surfaces need review" || report.Findings[1].Title != "Curvature analysis unavailable" {
		t.Fatalf("unexpected findings: %#v", report.Findings)
	}
	if got := report.Evidence[len(report.Evidence)-1].Value; got != float64(1) {
		t.Fatalf("unexpected AABB separation: %#v", got)
	}
}
