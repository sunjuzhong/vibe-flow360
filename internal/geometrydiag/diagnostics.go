package geometrydiag

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
)

const SchemaVersion = 2

type Settings struct {
	SmallSurfaceRatio      float64 `json:"small_surface_ratio"`
	CurvatureAngleDeg      float64 `json:"curvature_angle_deg"`
	TopologyToleranceRatio float64 `json:"topology_tolerance_ratio"`
}

type TopologyCheck struct {
	Key       string   `json:"key"`
	Status    string   `json:"status"`
	Count     int      `json:"count,omitempty"`
	Detail    string   `json:"detail"`
	EntityIDs []string `json:"entity_ids,omitempty"`
}

type TopologyReport struct {
	Status             string          `json:"status"`
	AlgorithmVersion   string          `json:"algorithm_version"`
	Source             string          `json:"source"`
	Tolerance          float64         `json:"tolerance"`
	ToleranceBasis     string          `json:"tolerance_basis"`
	TriangleCount      int             `json:"triangle_count"`
	DegenerateCount    int             `json:"degenerate_triangle_count"`
	CandidatePairCount int             `json:"candidate_pair_count"`
	StartedAt          time.Time       `json:"started_at"`
	CompletedAt        time.Time       `json:"completed_at"`
	DurationMillis     int64           `json:"duration_ms"`
	Checks             []TopologyCheck `json:"checks"`
	Limitations        []string        `json:"limitations,omitempty"`
}

type Capability struct {
	Key    string `json:"key"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type Evidence struct {
	Key        string `json:"key"`
	Label      string `json:"label"`
	Value      any    `json:"value"`
	Unit       string `json:"unit,omitempty"`
	Provenance string `json:"provenance"`
	Method     string `json:"method"`
}

type Finding struct {
	ID             string   `json:"id"`
	Kind           string   `json:"kind"`
	Severity       string   `json:"severity"`
	Title          string   `json:"title"`
	Detail         string   `json:"detail"`
	EntityIDs      []string `json:"entity_ids,omitempty"`
	EvidenceKeys   []string `json:"evidence_keys,omitempty"`
	Recommendation string   `json:"recommendation,omitempty"`
}

type GroupingProposal struct {
	ID         string   `json:"id"`
	Label      string   `json:"label"`
	Basis      string   `json:"basis"`
	EntityIDs  []string `json:"entity_ids"`
	Provenance string   `json:"provenance"`
}

type Report struct {
	SchemaVersion int                `json:"schema_version"`
	GeometryID    string             `json:"geometry_id"`
	Fingerprint   string             `json:"fingerprint"`
	Settings      Settings           `json:"settings"`
	Capabilities  []Capability       `json:"capabilities"`
	Evidence      []Evidence         `json:"evidence"`
	Findings      []Finding          `json:"findings"`
	Groupings     []GroupingProposal `json:"grouping_proposals"`
	Topology      *TopologyReport    `json:"topology,omitempty"`
}

type ComparisonMetric struct {
	Key       string  `json:"key"`
	Label     string  `json:"label"`
	Baseline  float64 `json:"baseline"`
	Candidate float64 `json:"candidate"`
	Delta     float64 `json:"delta"`
	Unit      string  `json:"unit,omitempty"`
}

type Comparison struct {
	SchemaVersion   int                `json:"schema_version"`
	BaselineID      string             `json:"baseline_id"`
	CandidateID     string             `json:"candidate_id"`
	Metrics         []ComparisonMetric `json:"metrics"`
	AddedSurfaces   []string           `json:"added_surfaces"`
	RemovedSurfaces []string           `json:"removed_surfaces"`
	Provenance      string             `json:"provenance"`
}

type manifestEntry struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Properties struct {
		Area            *float64   `json:"area"`
		BoundsMin       [3]float64 `json:"boundsMin"`
		BoundsMax       [3]float64 `json:"boundsMax"`
		BufferLocations struct {
			Indices []struct {
				StartIndex int `json:"startIndex"`
				EndIndex   int `json:"endIndex"`
			} `json:"indices"`
		} `json:"bufferLocations"`
	} `json:"properties"`
	Attributions struct {
		PackedParentID string `json:"packedParentId"`
	} `json:"attributions"`
	Resources struct {
		Buffers manifestBuffer `json:"buffers"`
	} `json:"resources"`
}

type manifestBufferSection struct {
	Name      string `json:"name"`
	DType     string `json:"dType"`
	Dimension int    `json:"dimension"`
	Offset    int    `json:"offset"`
	Length    int    `json:"length"`
}

type manifestBuffer struct {
	Type     string                  `json:"type"`
	Path     string                  `json:"path"`
	Default  int                     `json:"default"`
	Sections []manifestBufferSection `json:"sections"`
	Levels   []struct {
		Path     string                  `json:"path"`
		Sections []manifestBufferSection `json:"sections"`
	} `json:"levels"`
}

type curvatureSample struct {
	EntityID string
	AngleDeg float64
	Normals  int
}

type solidBounds struct {
	ID  string
	Min [3]float64
	Max [3]float64
}

var generatedBodyFace = regexp.MustCompile(`(?i)^(body[0-9]+)_face_[0-9]+$`)

func NormalizeSettings(settings Settings) Settings {
	if settings.SmallSurfaceRatio <= 0 || settings.SmallSurfaceRatio > 1 {
		settings.SmallSurfaceRatio = 0.1
	}
	if settings.CurvatureAngleDeg <= 0 || settings.CurvatureAngleDeg > 180 {
		settings.CurvatureAngleDeg = 30
	}
	if settings.TopologyToleranceRatio <= 0 || settings.TopologyToleranceRatio > 1e-3 {
		settings.TopologyToleranceRatio = 1e-8
	}
	return settings
}

func Analyze(geometryID string, manifest json.RawMessage, settings Settings) (Report, error) {
	return AnalyzeWithBuffers(geometryID, manifest, nil, settings)
}

func AnalyzeWithBuffers(geometryID string, manifest json.RawMessage, buffers map[string][]byte, settings Settings) (Report, error) {
	settings = NormalizeSettings(settings)
	preview, err := flow360.GeometryUVFPreview(geometryID, manifest, "cached-manifest")
	if err != nil {
		return Report{}, err
	}
	var entries []manifestEntry
	if err := json.Unmarshal(manifest, &entries); err != nil {
		return Report{}, errors.New("invalid Geometry visualization manifest")
	}

	triangles := make([]int, 0, len(preview.Groups))
	areas := []float64{}
	areaByID := map[string]float64{}
	groupMembers := map[string][]string{}
	firstFaceByBody := map[string]string{}
	solids := []solidBounds{}
	solidEntries := map[string]manifestEntry{}
	for _, entry := range entries {
		if entry.Type == "SolidGeometry" {
			solidEntries[entry.ID] = entry
			if entry.Properties.BoundsMin != entry.Properties.BoundsMax {
				solids = append(solids, solidBounds{ID: entry.ID, Min: entry.Properties.BoundsMin, Max: entry.Properties.BoundsMax})
			}
		}
		if entry.Type != "Face" {
			continue
		}
		if entry.Properties.Area != nil && *entry.Properties.Area > 0 {
			areas = append(areas, *entry.Properties.Area)
			areaByID[entry.ID] = *entry.Properties.Area
		}
		if entry.Attributions.PackedParentID != "" && firstFaceByBody[entry.Attributions.PackedParentID] == "" {
			firstFaceByBody[entry.Attributions.PackedParentID] = entry.ID
		}
	}
	curvatureSamples := analyzeCurvature(entries, solidEntries, buffers)
	topology := analyzeTopology(entries, solidEntries, buffers, preview.BoundingBox, settings)
	curvatureAngles := make([]float64, 0, len(curvatureSamples))
	highCurvatureIDs := []string{}
	for _, sample := range curvatureSamples {
		curvatureAngles = append(curvatureAngles, sample.AngleDeg)
		if sample.AngleDeg >= settings.CurvatureAngleDeg {
			highCurvatureIDs = append(highCurvatureIDs, sample.EntityID)
		}
	}
	sort.Strings(highCurvatureIDs)
	for _, group := range preview.Groups {
		triangles = append(triangles, group.Triangles)
		if match := generatedBodyFace.FindStringSubmatch(group.Name); len(match) == 2 {
			groupMembers[strings.ToLower(match[1])] = append(groupMembers[strings.ToLower(match[1])], group.ID)
		} else if match := generatedBodyFace.FindStringSubmatch(group.ID); len(match) == 2 {
			groupMembers[strings.ToLower(match[1])] = append(groupMembers[strings.ToLower(match[1])], group.ID)
		}
	}
	median := medianInt(triangles)
	threshold := int(math.Max(2, math.Floor(float64(median)*settings.SmallSurfaceRatio)))
	medianArea := medianFloat(areas)
	areaThreshold := medianArea * settings.SmallSurfaceRatio
	smallIDs := []string{}
	for _, group := range preview.Groups {
		area, hasArea := areaByID[group.ID]
		if (hasArea && area <= areaThreshold) || (!hasArea && len(areas) == 0 && group.Triangles > 0 && group.Triangles <= threshold) {
			smallIDs = append(smallIDs, group.ID)
		}
	}
	sort.Strings(smallIDs)

	dimensions := [3]float64{}
	for index := range dimensions {
		dimensions[index] = preview.BoundingBox.Max[index] - preview.BoundingBox.Min[index]
	}
	diagonal := math.Sqrt(dimensions[0]*dimensions[0] + dimensions[1]*dimensions[1] + dimensions[2]*dimensions[2])
	fingerprint := diagnosticFingerprint(manifest, buffers, settings)
	smallFeatureStatus := "proxy"
	smallFeatureDetail := "Candidate surfaces use a triangle-count distribution proxy; this is not a physical feature-size calculation."
	if len(areas) > 0 {
		smallFeatureStatus = "available"
		smallFeatureDetail = "Candidate surfaces use Flow360-provided CAD face areas and a user-controlled relative threshold."
	}
	proximityStatus := "unavailable"
	proximityDetail := "The cached UVF manifest does not contain multiple bounded solid entities."
	minimumSeparation, proximityBodies, hasProximity := minimumAABBSeparation(solids)
	if hasProximity {
		proximityStatus = "proxy"
		proximityDetail = "Computed from solid-entity axis-aligned bounds; this is a lower-bound proxy, not exact CAD clearance."
	}
	curvatureStatus := "unavailable"
	curvatureDetail := "No compatible tessellated normal buffer was available to the server."
	curvatureFindings := []Finding{{
		ID: "curvature-analysis-unavailable", Kind: "curvature", Severity: "unknown", Title: "Curvature analysis unavailable",
		Detail: curvatureDetail, Recommendation: "Treat curvature-based refinement as an engineering input until supported evidence is available.",
	}}
	if len(curvatureSamples) > 0 {
		curvatureStatus = "proxy"
		curvatureDetail = "Computed from maximum normal-vector variation within each tessellated Face; this is not CAD curvature radius."
		curvatureFindings = []Finding{}
		if len(highCurvatureIDs) > 0 {
			curvatureFindings = append(curvatureFindings, Finding{
				ID: "high-normal-variation", Kind: "curvature", Severity: "warning", Title: "High normal-variation surfaces",
				Detail:    "These tessellated surfaces exceed the configured maximum face-normal variation threshold.",
				EntityIDs: highCurvatureIDs, EvidenceKeys: []string{"curvature_angle_threshold", "maximum_face_normal_variation"},
				Recommendation: "Inspect these surfaces and confirm whether curvature-sensitive surface refinement is required.",
			})
		}
	}
	report := Report{
		SchemaVersion: SchemaVersion,
		GeometryID:    geometryID,
		Fingerprint:   fingerprint,
		Settings:      settings,
		Capabilities: []Capability{
			{Key: "topology-analysis", Status: topology.Status, Detail: topologyCapabilityDetail(topology)},
			{Key: "small-features", Status: smallFeatureStatus, Detail: smallFeatureDetail},
			{Key: "gap-analysis", Status: proximityStatus, Detail: proximityDetail},
			{Key: "curvature-analysis", Status: curvatureStatus, Detail: curvatureDetail},
			{Key: "proximity-analysis", Status: proximityStatus, Detail: proximityDetail},
			{Key: "exact-cad-clearance", Status: "unavailable", Detail: "The synchronized Flow360 visualization API exposes tessellation and entity bounds, but no CAD topology or exact distance-query result. AABB proximity remains explicitly labeled as a proxy."},
		},
		Evidence: []Evidence{
			{Key: "surface_count", Label: "Surface count", Value: len(preview.Groups), Provenance: "computed", Method: "Counted Face entries in the cached Flow360 UVF manifest."},
			{Key: "vertex_count", Label: "Vertex count", Value: preview.Vertices, Provenance: "computed", Method: "Derived from the selected UVF position buffer length."},
			{Key: "triangle_count", Label: "Triangle count", Value: preview.Elements, Provenance: "computed", Method: "Summed indexed triangles attributed to Face entries."},
			{Key: "bounding_box_dimensions", Label: "Bounding-box dimensions", Value: dimensions, Provenance: "provided", Method: "Read from Flow360 UVF SolidGeometry bounds."},
			{Key: "bounding_box_diagonal", Label: "Bounding-box diagonal", Value: diagonal, Provenance: "computed", Method: "Euclidean norm of Flow360 UVF bounds dimensions."},
			{Key: "median_surface_triangles", Label: "Median triangles per surface", Value: median, Provenance: "computed", Method: "Median of indexed triangle counts for Face entries."},
			{Key: "small_surface_proxy_threshold", Label: "Small-surface proxy threshold", Value: threshold, Unit: "triangles", Provenance: "inferred", Method: "max(2, floor(median triangles × configured ratio))."},
		},
		Findings:  curvatureFindings,
		Groupings: []GroupingProposal{},
		Topology:  &topology,
	}
	report.Findings = append(report.Findings, topologyFindings(topology)...)
	report.Evidence = append(report.Evidence,
		Evidence{Key: "topology_triangle_count", Label: "Topology triangle count", Value: topology.TriangleCount, Provenance: "computed", Method: "Count of valid indexed triangles read from the synchronized default-LOD UVF buffer."},
		Evidence{Key: "topology_tolerance", Label: "Topology welding tolerance", Value: topology.Tolerance, Unit: "model-unit", Provenance: "computed", Method: topology.ToleranceBasis + "."},
		Evidence{Key: "topology_algorithm_version", Label: "Topology algorithm", Value: topology.AlgorithmVersion, Provenance: "computed", Method: "Versioned UVF topology diagnostic implementation."},
	)
	if len(areas) > 0 {
		report.Evidence = append(report.Evidence,
			Evidence{Key: "median_surface_area", Label: "Median surface area", Value: medianArea, Unit: "model-unit²", Provenance: "provided", Method: "Median of Flow360 UVF Face properties.area values."},
			Evidence{Key: "small_surface_area_threshold", Label: "Small-surface area threshold", Value: areaThreshold, Unit: "model-unit²", Provenance: "computed", Method: "Median provided face area × configured ratio."},
		)
	}
	if len(curvatureSamples) > 0 {
		report.Evidence = append(report.Evidence,
			Evidence{Key: "curvature_analyzed_surfaces", Label: "Curvature-proxy surfaces", Value: len(curvatureSamples), Provenance: "computed", Method: "Count of Faces with readable indexed tessellation normals."},
			Evidence{Key: "median_face_normal_variation", Label: "Median face-normal variation", Value: medianFloat(curvatureAngles), Unit: "degree", Provenance: "computed", Method: "Median per-Face maximum pairwise angle from sampled tessellation normals."},
			Evidence{Key: "maximum_face_normal_variation", Label: "Maximum face-normal variation", Value: maxFloat(curvatureAngles), Unit: "degree", Provenance: "computed", Method: "Maximum per-Face sampled tessellation-normal angle."},
			Evidence{Key: "curvature_angle_threshold", Label: "Curvature-proxy threshold", Value: settings.CurvatureAngleDeg, Unit: "degree", Provenance: "provided", Method: "User-controlled threshold for tessellated face-normal variation."},
		)
	}
	if hasProximity {
		report.Evidence = append(report.Evidence, Evidence{
			Key: "minimum_aabb_separation", Label: "Minimum solid AABB separation", Value: minimumSeparation,
			Unit: "model-unit", Provenance: "computed", Method: "Minimum Euclidean separation between Flow360-provided solid axis-aligned bounds.",
		})
		entityIDs := []string{}
		for _, bodyID := range proximityBodies {
			if faceID := firstFaceByBody[bodyID]; faceID != "" {
				entityIDs = append(entityIDs, faceID)
			}
		}
		report.Findings = append(report.Findings, Finding{
			ID: "body-proximity-proxy", Kind: "proximity", Severity: "warning", Title: "Solid proximity lower bound",
			Detail:    "The closest solid bounding boxes are separated by the reported lower bound; overlapping boxes produce zero and remain inconclusive.",
			EntityIDs: entityIDs, EvidenceKeys: []string{"minimum_aabb_separation"},
			Recommendation: "Inspect the implicated bodies and confirm clearance with a CAD-kernel or mesher-supported distance calculation.",
		})
	} else {
		report.Findings = append(report.Findings,
			Finding{ID: "gap-analysis-unavailable", Kind: "gap", Severity: "unknown", Title: "Gap analysis unavailable", Detail: "No multi-body distance evidence exists in the cached visualization manifest.", Recommendation: "Run a CAD-kernel or mesher-supported gap diagnostic before using a gap tolerance."},
			Finding{ID: "proximity-analysis-unavailable", Kind: "proximity", Severity: "unknown", Title: "Proximity analysis unavailable", Detail: "Multiple bounded solids are required for the AABB proximity proxy.", Recommendation: "Do not infer close-body clearances from the rendered view alone."},
		)
	}
	if len(smallIDs) > 0 {
		title := "Low-triangle surfaces need review"
		detail := "These surfaces are statistical tessellation outliers, not confirmed small physical features."
		evidenceKeys := []string{"median_surface_triangles", "small_surface_proxy_threshold"}
		if len(areas) > 0 {
			title = "Small-area surfaces need review"
			detail = "These surfaces fall below the configured fraction of the median Flow360-provided CAD face area."
			evidenceKeys = []string{"median_surface_area", "small_surface_area_threshold"}
		}
		report.Findings = append([]Finding{{
			ID: "small-surface-proxy", Kind: "small-feature", Severity: "warning",
			Title: title, Detail: detail,
			EntityIDs: smallIDs, EvidenceKeys: evidenceKeys,
			Recommendation: "Focus the candidates in 3D and confirm physical dimensions before suppressing or refining them.",
		}}, report.Findings...)
	}
	labels := make([]string, 0, len(groupMembers))
	for label := range groupMembers {
		labels = append(labels, label)
	}
	sort.Strings(labels)
	for _, label := range labels {
		members := groupMembers[label]
		if len(members) < 2 {
			continue
		}
		sort.Strings(members)
		report.Groupings = append(report.Groupings, GroupingProposal{
			ID: "group-" + label, Label: label, Basis: "Shared generated CAD body prefix; requires engineering review.",
			EntityIDs: members, Provenance: "inferred",
		})
	}
	return report, nil
}

func Compare(baselineID string, baselineManifest json.RawMessage, candidateID string, candidateManifest json.RawMessage) (Comparison, error) {
	baseline, err := flow360.GeometryUVFPreview(baselineID, baselineManifest, "cached-manifest")
	if err != nil {
		return Comparison{}, err
	}
	candidate, err := flow360.GeometryUVFPreview(candidateID, candidateManifest, "cached-manifest")
	if err != nil {
		return Comparison{}, err
	}
	diagonal := func(bounds flow360.BoundingBox) float64 {
		x := bounds.Max[0] - bounds.Min[0]
		y := bounds.Max[1] - bounds.Min[1]
		z := bounds.Max[2] - bounds.Min[2]
		return math.Sqrt(x*x + y*y + z*z)
	}
	metrics := []ComparisonMetric{
		{Key: "surfaces", Label: "Surfaces", Baseline: float64(len(baseline.Groups)), Candidate: float64(len(candidate.Groups))},
		{Key: "vertices", Label: "Vertices", Baseline: float64(baseline.Vertices), Candidate: float64(candidate.Vertices)},
		{Key: "triangles", Label: "Triangles", Baseline: float64(baseline.Elements), Candidate: float64(candidate.Elements)},
		{Key: "diagonal", Label: "Bounding-box diagonal", Baseline: diagonal(baseline.BoundingBox), Candidate: diagonal(candidate.BoundingBox)},
	}
	for index := range metrics {
		metrics[index].Delta = metrics[index].Candidate - metrics[index].Baseline
	}
	baselineNames := groupSet(baseline.Groups)
	candidateNames := groupSet(candidate.Groups)
	return Comparison{
		SchemaVersion: SchemaVersion, BaselineID: baselineID, CandidateID: candidateID,
		Metrics:         metrics,
		AddedSurfaces:   setDifference(candidateNames, baselineNames),
		RemovedSurfaces: setDifference(baselineNames, candidateNames),
		Provenance:      "Computed server-side from cached Flow360 UVF manifests; identical generated names do not prove CAD entity identity.",
	}, nil
}

func medianInt(values []int) int {
	if len(values) == 0 {
		return 0
	}
	copyValues := append([]int(nil), values...)
	sort.Ints(copyValues)
	middle := len(copyValues) / 2
	if len(copyValues)%2 == 1 {
		return copyValues[middle]
	}
	return (copyValues[middle-1] + copyValues[middle]) / 2
}

func medianFloat(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	copyValues := append([]float64(nil), values...)
	sort.Float64s(copyValues)
	middle := len(copyValues) / 2
	if len(copyValues)%2 == 1 {
		return copyValues[middle]
	}
	return (copyValues[middle-1] + copyValues[middle]) / 2
}

func minimumAABBSeparation(solids []solidBounds) (float64, [2]string, bool) {
	if len(solids) < 2 {
		return 0, [2]string{}, false
	}
	minimum := math.Inf(1)
	pair := [2]string{}
	for left := 0; left < len(solids); left++ {
		for right := left + 1; right < len(solids); right++ {
			distanceSquared := 0.0
			for axis := 0; axis < 3; axis++ {
				gap := math.Max(0, math.Max(
					solids[left].Min[axis]-solids[right].Max[axis],
					solids[right].Min[axis]-solids[left].Max[axis],
				))
				distanceSquared += gap * gap
			}
			distance := math.Sqrt(distanceSquared)
			if distance < minimum {
				minimum = distance
				pair = [2]string{solids[left].ID, solids[right].ID}
			}
		}
	}
	return minimum, pair, true
}

func Fingerprint(manifest json.RawMessage, buffers map[string][]byte, settings Settings) string {
	return diagnosticFingerprint(manifest, buffers, NormalizeSettings(settings))
}

func diagnosticFingerprint(manifest json.RawMessage, buffers map[string][]byte, settings Settings) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte{SchemaVersion})
	_, _ = hash.Write(manifest)
	settingsPayload, _ := json.Marshal(settings)
	_, _ = hash.Write(settingsPayload)
	paths := make([]string, 0, len(buffers))
	for path := range buffers {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		_, _ = hash.Write([]byte(path))
		_, _ = hash.Write(buffers[path])
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func analyzeCurvature(entries []manifestEntry, solids map[string]manifestEntry, buffers map[string][]byte) []curvatureSample {
	if len(buffers) == 0 {
		return nil
	}
	result := []curvatureSample{}
	for _, face := range entries {
		if face.Type != "Face" || face.Attributions.PackedParentID == "" {
			continue
		}
		solid, exists := solids[face.Attributions.PackedParentID]
		if !exists {
			continue
		}
		bufferPath, sections, ok := selectedManifestBuffer(solid.Resources.Buffers)
		if !ok {
			continue
		}
		payload := buffers[bufferPath]
		indexSection, hasIndices := findBufferSection(sections, "indices")
		normalSection, hasNormals := findBufferSection(sections, "normal", "nodeNormals")
		if !hasIndices || !hasNormals || indexSection.DType != "uint32" || normalSection.DType != "float32" || normalSection.Dimension < 3 || normalSection.Dimension > 4 {
			continue
		}
		normals := make([][3]float64, 0, 128)
		for _, location := range face.Properties.BufferLocations.Indices {
			count := location.EndIndex - location.StartIndex
			if count <= 0 {
				continue
			}
			step := maxInt(1, (count+127)/128)
			for position := location.StartIndex; position < location.EndIndex && len(normals) < 128; position += step {
				vertexIndex, ok := readUint32Section(payload, indexSection, position)
				if !ok {
					continue
				}
				normal, ok := readNormal(payload, normalSection, int(vertexIndex))
				if ok {
					normals = append(normals, normal)
				}
			}
		}
		angle, ok := maximumNormalAngle(normals)
		if ok {
			result = append(result, curvatureSample{EntityID: face.ID, AngleDeg: angle, Normals: len(normals)})
		}
	}
	return result
}

func selectedManifestBuffer(buffer manifestBuffer) (string, []manifestBufferSection, bool) {
	if buffer.Type != "lod" {
		return buffer.Path, buffer.Sections, buffer.Path != "" && len(buffer.Sections) > 0
	}
	index := buffer.Default
	if index < 0 || index >= len(buffer.Levels) {
		return "", nil, false
	}
	level := buffer.Levels[index]
	return level.Path, level.Sections, level.Path != "" && len(level.Sections) > 0
}

func findBufferSection(sections []manifestBufferSection, names ...string) (manifestBufferSection, bool) {
	for _, section := range sections {
		for _, name := range names {
			if section.Name == name {
				return section, true
			}
		}
	}
	return manifestBufferSection{}, false
}

func readUint32Section(payload []byte, section manifestBufferSection, index int) (uint32, bool) {
	offset := section.Offset + index*4
	end := section.Offset + section.Length
	if index < 0 || section.Offset < 0 || section.Length < 0 || offset < section.Offset || offset+4 > end || offset+4 > len(payload) {
		return 0, false
	}
	return binary.LittleEndian.Uint32(payload[offset : offset+4]), true
}

func readNormal(payload []byte, section manifestBufferSection, vertexIndex int) ([3]float64, bool) {
	stride := section.Dimension * 4
	offset := section.Offset + vertexIndex*stride
	end := section.Offset + section.Length
	if vertexIndex < 0 || stride < 12 || section.Offset < 0 || section.Length < 0 || offset < section.Offset || offset+12 > end || offset+12 > len(payload) {
		return [3]float64{}, false
	}
	normal := [3]float64{
		float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[offset : offset+4]))),
		float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[offset+4 : offset+8]))),
		float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[offset+8 : offset+12]))),
	}
	magnitude := math.Sqrt(normal[0]*normal[0] + normal[1]*normal[1] + normal[2]*normal[2])
	if magnitude == 0 || math.IsNaN(magnitude) || math.IsInf(magnitude, 0) {
		return [3]float64{}, false
	}
	for axis := range normal {
		normal[axis] /= magnitude
	}
	return normal, true
}

func maximumNormalAngle(normals [][3]float64) (float64, bool) {
	if len(normals) < 2 {
		return 0, false
	}
	minimumDot := 1.0
	for left := 0; left < len(normals); left++ {
		for right := left + 1; right < len(normals); right++ {
			dot := normals[left][0]*normals[right][0] + normals[left][1]*normals[right][1] + normals[left][2]*normals[right][2]
			minimumDot = math.Min(minimumDot, math.Max(-1, math.Min(1, dot)))
		}
	}
	return math.Acos(minimumDot) * 180 / math.Pi, true
}

func maxFloat(values []float64) float64 {
	maximum := 0.0
	for _, value := range values {
		maximum = math.Max(maximum, value)
	}
	return maximum
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func groupSet(groups []flow360.MeshGroup) map[string]struct{} {
	result := make(map[string]struct{}, len(groups))
	for _, group := range groups {
		name := strings.TrimSpace(group.Name)
		if name == "" {
			name = group.ID
		}
		result[name] = struct{}{}
	}
	return result
}

func setDifference(left, right map[string]struct{}) []string {
	result := []string{}
	for value := range left {
		if _, exists := right[value]; !exists {
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}
