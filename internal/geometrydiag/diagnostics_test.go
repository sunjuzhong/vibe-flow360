package geometrydiag

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

func manifest(faceEntries string, positionLength int, maxX float64) json.RawMessage {
	return json.RawMessage(`[{"id":"solid","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[` + number(maxX) + `,2,3]},"resources":{"buffers":{"type":"buffers","sections":[{"name":"position","length":` + number(float64(positionLength)) + `}]}}},` + faceEntries + `]`)
}

func number(value float64) string {
	payload, _ := json.Marshal(value)
	return string(payload)
}

func capabilityStatus(report Report, key string) string {
	for _, capability := range report.Capabilities {
		if capability.Key == key {
			return capability.Status
		}
	}
	return ""
}

func TestAnalyzeKeepsProxyAndUnavailableCapabilitiesExplicit(t *testing.T) {
	raw := manifest(`
		{"id":"body00001_face_0","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}},
		{"id":"body00001_face_1","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":3,"endIndex":33}]}}}`, 144, 1)
	report, err := Analyze("geo-1", raw, Settings{SmallSurfaceRatio: 0.2})
	if err != nil {
		t.Fatal(err)
	}
	if capabilityStatus(report, "small-features") != "proxy" || capabilityStatus(report, "gap-analysis") != "unavailable" {
		t.Fatalf("unsupported capability was overstated: %#v", report.Capabilities)
	}
	if len(report.Findings) < 4 || len(report.Findings[0].EntityIDs) != 1 {
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
	if capabilityStatus(report, "small-features") != "available" || capabilityStatus(report, "gap-analysis") != "proxy" {
		t.Fatalf("unexpected capabilities: %#v", report.Capabilities)
	}
	if report.Findings[0].Title != "Small-area surfaces need review" || report.Findings[1].Title != "Curvature analysis unavailable" {
		t.Fatalf("unexpected findings: %#v", report.Findings)
	}
	if got := report.Evidence[len(report.Evidence)-1].Value; got != float64(1) {
		t.Fatalf("unexpected AABB separation: %#v", got)
	}
}

func TestAnalyzeExplicitlySeparatesExactCADClearanceFromProxy(t *testing.T) {
	manifest := json.RawMessage(`[
		{"id":"solid-a","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[1,1,1]},"resources":{"buffers":{"type":"buffers","sections":[{"name":"position","length":36}]}}},
		{"id":"solid-b","type":"SolidGeometry","properties":{"boundsMin":[2,0,0],"boundsMax":[3,1,1]},"resources":{"buffers":{"type":"buffers","sections":[{"name":"position","length":36}]}}},
		{"id":"face-a","type":"Face","properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}}
	]`)
	report, err := Analyze("geo-1", manifest, Settings{})
	if err != nil {
		t.Fatal(err)
	}
	capabilities := map[string]Capability{}
	for _, capability := range report.Capabilities {
		capabilities[capability.Key] = capability
	}
	if capabilities["exact-cad-clearance"].Status != "unavailable" {
		t.Fatalf("exact capability must be unavailable: %#v", capabilities["exact-cad-clearance"])
	}
	if capabilities["proximity-analysis"].Status != "proxy" {
		t.Fatalf("AABB proximity must remain a proxy: %#v", capabilities["proximity-analysis"])
	}
}

func TestAnalyzeCurvatureReadsIndexedTessellationNormals(t *testing.T) {
	raw := json.RawMessage(`[
		{"id":"body","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[1,1,1]},"resources":{"buffers":{"type":"buffers","path":"geometry.bin","sections":[
			{"name":"indices","dType":"uint32","dimension":1,"offset":0,"length":12},
			{"name":"position","dType":"float32","dimension":3,"offset":12,"length":36},
			{"name":"normal","dType":"float32","dimension":3,"offset":48,"length":36}
		]}}},
		{"id":"face-curved","name":"curved","type":"Face","attributions":{"packedParentId":"body"},"properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}}
	]`)
	payload := make([]byte, 84)
	for index := 0; index < 3; index++ {
		binary.LittleEndian.PutUint32(payload[index*4:index*4+4], uint32(index))
	}
	normals := [][3]float32{{0, 0, 1}, {1, 0, 0}, {0, 0, 1}}
	for index, normal := range normals {
		for axis, value := range normal {
			offset := 48 + index*12 + axis*4
			binary.LittleEndian.PutUint32(payload[offset:offset+4], math.Float32bits(value))
		}
	}
	report, err := AnalyzeWithBuffers("geo-curved", raw, map[string][]byte{"geometry.bin": payload}, Settings{CurvatureAngleDeg: 45})
	if err != nil {
		t.Fatal(err)
	}
	if capabilityStatus(report, "curvature-analysis") != "proxy" {
		t.Fatalf("curvature capability unavailable: %#v", report.Capabilities)
	}
	foundCurvature := false
	for _, finding := range report.Findings {
		if finding.ID == "high-normal-variation" && len(finding.EntityIDs) == 1 && finding.EntityIDs[0] == "face-curved" {
			foundCurvature = true
		}
	}
	if !foundCurvature {
		t.Fatalf("unexpected curvature findings: %#v", report.Findings)
	}
	foundMaximum := false
	for _, evidence := range report.Evidence {
		if evidence.Key == "maximum_face_normal_variation" {
			foundMaximum = math.Abs(evidence.Value.(float64)-90) < 1e-6
		}
	}
	if !foundMaximum {
		t.Fatalf("missing 90-degree normal variation: %#v", report.Evidence)
	}
}

func TestAnalyzeTopologyFindsClosedConnectedTetrahedron(t *testing.T) {
	indices := []uint32{0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3}
	positions := [][3]float32{{0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	payload := indexedTrianglePayload(indices, positions)
	raw := json.RawMessage(`[
		{"id":"body","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[1,1,1]},"resources":{"buffers":{"type":"buffers","path":"geometry.bin","sections":[
			{"name":"indices","dType":"uint32","dimension":1,"offset":0,"length":48},
			{"name":"position","dType":"float32","dimension":3,"offset":48,"length":48}
		]}}},
		{"id":"face-a","type":"Face","attributions":{"packedParentId":"body"},"properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":6}]}}},
		{"id":"face-b","type":"Face","attributions":{"packedParentId":"body"},"properties":{"bufferLocations":{"indices":[{"startIndex":6,"endIndex":12}]}}}
	]`)
	report, err := AnalyzeWithBuffers("geo-topology", raw, map[string][]byte{"geometry.bin": payload}, Settings{})
	if err != nil {
		t.Fatal(err)
	}
	if report.Topology == nil || report.Topology.Status != "available" || report.Topology.TriangleCount != 4 {
		t.Fatalf("topology unavailable: %#v", report.Topology)
	}
	for _, check := range report.Topology.Checks {
		if check.Status != "ready" {
			t.Fatalf("closed tetrahedron should pass %s: %#v", check.Key, check)
		}
	}
}

func TestAnalyzeTopologyFindsOpenDisconnectedTriangles(t *testing.T) {
	indices := []uint32{0, 1, 2, 3, 4, 5}
	positions := [][3]float32{{0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {3, 0, 0}, {4, 0, 0}, {3, 1, 0}}
	payload := indexedTrianglePayload(indices, positions)
	raw := json.RawMessage(`[
		{"id":"body","type":"SolidGeometry","properties":{"boundsMin":[0,0,0],"boundsMax":[4,1,0]},"resources":{"buffers":{"type":"buffers","path":"geometry.bin","sections":[
			{"name":"indices","dType":"uint32","dimension":1,"offset":0,"length":24},
			{"name":"position","dType":"float32","dimension":3,"offset":24,"length":72}
		]}}},
		{"id":"face-a","type":"Face","attributions":{"packedParentId":"body"},"properties":{"bufferLocations":{"indices":[{"startIndex":0,"endIndex":3}]}}},
		{"id":"face-b","type":"Face","attributions":{"packedParentId":"body"},"properties":{"bufferLocations":{"indices":[{"startIndex":3,"endIndex":6}]}}}
	]`)
	report, err := AnalyzeWithBuffers("geo-open", raw, map[string][]byte{"geometry.bin": payload}, Settings{})
	if err != nil {
		t.Fatal(err)
	}
	checks := map[string]TopologyCheck{}
	for _, check := range report.Topology.Checks {
		checks[check.Key] = check
	}
	if checks["free-edges"].Count != 6 || checks["free-edges"].Status != "blocked" {
		t.Fatalf("unexpected free-edge result: %#v", checks["free-edges"])
	}
	if checks["components"].Count != 2 || checks["components"].Status != "warning" {
		t.Fatalf("unexpected component result: %#v", checks["components"])
	}
}

func indexedTrianglePayload(indices []uint32, positions [][3]float32) []byte {
	payload := make([]byte, len(indices)*4+len(positions)*12)
	for index, value := range indices {
		binary.LittleEndian.PutUint32(payload[index*4:index*4+4], value)
	}
	positionOffset := len(indices) * 4
	for index, point := range positions {
		for axis, value := range point {
			offset := positionOffset + index*12 + axis*4
			binary.LittleEndian.PutUint32(payload[offset:offset+4], math.Float32bits(value))
		}
	}
	return payload
}
