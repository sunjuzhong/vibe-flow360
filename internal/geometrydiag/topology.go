package geometrydiag

import (
	"encoding/binary"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/sunjuzhong/vibe-flow360/internal/flow360"
)

const (
	topologyAlgorithmVersion = "uvf-topology-v1"
	maxIntersectionTriangles = 250_000
	maxIntersectionPairs     = 2_000_000
	bvhLeafSize              = 8
)

type topologyVertex struct {
	X int64
	Y int64
	Z int64
}

type topologyEdge struct {
	A topologyVertex
	B topologyVertex
}

type topologyTriangle struct {
	Points   [3][3]float64
	Vertices [3]topologyVertex
	EntityID string
	Bounds   topologyBounds
}

type topologyBounds struct {
	Min [3]float64
	Max [3]float64
}

type edgeUse struct {
	Triangles []int
	Entities  map[string]struct{}
}

type unionFind struct {
	parent []int
	rank   []uint8
}

type bvhNode struct {
	Bounds topologyBounds
	Left   *bvhNode
	Right  *bvhNode
	Items  []int
}

func analyzeTopology(
	entries []manifestEntry,
	solids map[string]manifestEntry,
	buffers map[string][]byte,
	bounds flow360.BoundingBox,
	settings Settings,
) TopologyReport {
	started := time.Now().UTC()
	diagonal := math.Sqrt(
		math.Pow(bounds.Max[0]-bounds.Min[0], 2) +
			math.Pow(bounds.Max[1]-bounds.Min[1], 2) +
			math.Pow(bounds.Max[2]-bounds.Min[2], 2),
	)
	tolerance := diagonal * settings.TopologyToleranceRatio
	if tolerance <= 0 || math.IsNaN(tolerance) || math.IsInf(tolerance, 0) {
		tolerance = settings.TopologyToleranceRatio
	}
	report := TopologyReport{
		Status:           "unavailable",
		AlgorithmVersion: topologyAlgorithmVersion,
		Source:           "Synchronized Flow360 UVF default-LOD indexed triangle buffers",
		Tolerance:        tolerance,
		ToleranceBasis:   fmt.Sprintf("bounding-box diagonal × %.3g", settings.TopologyToleranceRatio),
		StartedAt:        started,
		Checks: []TopologyCheck{
			{Key: "free-edges", Status: "unknown", Detail: "Indexed UVF positions and triangles are required."},
			{Key: "non-manifold", Status: "unknown", Detail: "Indexed UVF positions and triangles are required."},
			{Key: "self-intersections", Status: "unknown", Detail: "Indexed UVF positions and triangles are required."},
			{Key: "components", Status: "unknown", Detail: "Indexed UVF positions and triangles are required."},
		},
		Limitations: []string{
			"This analyzes the synchronized tessellation, not exact CAD B-rep topology.",
			"Results depend on the selected UVF LOD and the reported model coordinate scale.",
		},
	}
	triangles, degenerate := readTopologyTriangles(entries, solids, buffers, tolerance)
	report.TriangleCount = len(triangles)
	report.DegenerateCount = degenerate
	if len(triangles) == 0 {
		return finishTopologyReport(report)
	}

	edges := make(map[topologyEdge]*edgeUse, len(triangles)*2)
	components := newUnionFind(len(triangles))
	for index, triangle := range triangles {
		for edgeIndex := 0; edgeIndex < 3; edgeIndex++ {
			edge := canonicalEdge(triangle.Vertices[edgeIndex], triangle.Vertices[(edgeIndex+1)%3])
			usage := edges[edge]
			if usage == nil {
				usage = &edgeUse{Entities: map[string]struct{}{}}
				edges[edge] = usage
			}
			for _, prior := range usage.Triangles {
				components.union(index, prior)
			}
			usage.Triangles = append(usage.Triangles, index)
			usage.Entities[triangle.EntityID] = struct{}{}
		}
	}

	freeCount, nonManifoldCount := 0, 0
	freeEntities, nonManifoldEntities := map[string]struct{}{}, map[string]struct{}{}
	for _, usage := range edges {
		switch {
		case len(usage.Triangles) == 1:
			freeCount++
			mergeEntitySet(freeEntities, usage.Entities)
		case len(usage.Triangles) > 2:
			nonManifoldCount++
			mergeEntitySet(nonManifoldEntities, usage.Entities)
		}
	}
	componentEntities := map[int]map[string]struct{}{}
	for index, triangle := range triangles {
		root := components.find(index)
		if componentEntities[root] == nil {
			componentEntities[root] = map[string]struct{}{}
		}
		componentEntities[root][triangle.EntityID] = struct{}{}
	}
	allComponentEntities := map[string]struct{}{}
	for _, entities := range componentEntities {
		mergeEntitySet(allComponentEntities, entities)
	}

	intersectionStatus := "ready"
	intersectionDetail := "No non-adjacent triangle intersections detected by BVH broad-phase and triangle SAT narrow-phase."
	intersectionCount := 0
	intersectionEntities := []string{}
	if len(triangles) > maxIntersectionTriangles {
		intersectionStatus = "unknown"
		intersectionDetail = fmt.Sprintf("Self-intersection check skipped: %s triangles exceed the bounded limit of %s.", formatInteger(len(triangles)), formatInteger(maxIntersectionTriangles))
		report.Status = "partial"
		report.Limitations = append(report.Limitations, intersectionDetail)
	} else {
		intersectionCount, intersectionEntities, report.CandidatePairCount, intersectionStatus = findSelfIntersections(triangles, tolerance)
		if intersectionStatus == "unknown" {
			intersectionDetail = fmt.Sprintf("Self-intersection search stopped after the bounded limit of %s BVH candidate pairs.", formatInteger(maxIntersectionPairs))
			report.Status = "partial"
			report.Limitations = append(report.Limitations, intersectionDetail)
		} else if intersectionCount > 0 {
			intersectionStatus = "blocked"
			intersectionDetail = fmt.Sprintf("%s intersecting non-adjacent triangle pairs detected.", formatInteger(intersectionCount))
		}
	}

	report.Checks = []TopologyCheck{
		topologyCountCheck("free-edges", freeCount, "No free boundary edges detected.", "blocked", sortedEntitySet(freeEntities)),
		topologyCountCheck("non-manifold", nonManifoldCount, "No edges shared by more than two triangles detected.", "blocked", sortedEntitySet(nonManifoldEntities)),
		{Key: "self-intersections", Status: intersectionStatus, Count: intersectionCount, Detail: intersectionDetail, EntityIDs: intersectionEntities},
		{
			Key: "components", Status: componentStatus(len(componentEntities)), Count: len(componentEntities),
			Detail: componentDetail(len(componentEntities)), EntityIDs: sortedEntitySet(allComponentEntities),
		},
	}
	if report.Status != "partial" {
		report.Status = "available"
	}
	return finishTopologyReport(report)
}

func finishTopologyReport(report TopologyReport) TopologyReport {
	report.CompletedAt = time.Now().UTC()
	report.DurationMillis = report.CompletedAt.Sub(report.StartedAt).Milliseconds()
	return report
}

func topologyCapabilityDetail(report TopologyReport) string {
	switch report.Status {
	case "available":
		return "Computed from synchronized UVF indexed triangles using quantized edge incidence, union-find connectivity, and BVH/SAT self-intersection tests."
	case "partial":
		return "Edge incidence and connectivity were computed, but the bounded self-intersection stage was incomplete."
	default:
		return "Compatible synchronized UVF position and index buffers were not available."
	}
}

func topologyFindings(report TopologyReport) []Finding {
	findings := []Finding{}
	for _, check := range report.Checks {
		if check.Status == "ready" {
			continue
		}
		severity := "unknown"
		recommendation := "Run diagnostics again after synchronizing a compatible UVF asset."
		if check.Status == "blocked" {
			severity = "error"
			recommendation = "Locate the affected surfaces and repair or re-export the CAD topology before volume meshing."
		} else if check.Status == "warning" {
			severity = "warning"
			recommendation = "Review whether multiple disconnected bodies are intended for this CFD workflow."
		}
		findings = append(findings, Finding{
			ID: "topology-" + check.Key, Kind: "topology", Severity: severity,
			Title: topologyCheckTitle(check.Key), Detail: check.Detail, EntityIDs: check.EntityIDs,
			EvidenceKeys: []string{"topology_tolerance", "topology_triangle_count"}, Recommendation: recommendation,
		})
	}
	return findings
}

func topologyCheckTitle(key string) string {
	switch key {
	case "free-edges":
		return "Open / free edges"
	case "non-manifold":
		return "Non-manifold edges"
	case "self-intersections":
		return "Self-intersections"
	case "components":
		return "Disconnected components"
	default:
		return key
	}
}

func topologyCountCheck(key string, count int, readyDetail, issueStatus string, entityIDs []string) TopologyCheck {
	if count == 0 {
		return TopologyCheck{Key: key, Status: "ready", Detail: readyDetail}
	}
	return TopologyCheck{
		Key: key, Status: issueStatus, Count: count,
		Detail: fmt.Sprintf("%s detected.", formatInteger(count)), EntityIDs: entityIDs,
	}
}

func componentStatus(count int) string {
	if count <= 1 {
		return "ready"
	}
	return "warning"
}

func componentDetail(count int) string {
	if count == 1 {
		return "One edge-connected triangle component detected."
	}
	return fmt.Sprintf("%s disconnected triangle components detected; multiple CFD bodies may be intentional.", formatInteger(count))
}

func readTopologyTriangles(entries []manifestEntry, solids map[string]manifestEntry, buffers map[string][]byte, tolerance float64) ([]topologyTriangle, int) {
	triangles := []topologyTriangle{}
	degenerate := 0
	for _, face := range entries {
		if face.Type != "Face" || face.Attributions.PackedParentID == "" {
			continue
		}
		solid, ok := solids[face.Attributions.PackedParentID]
		if !ok {
			continue
		}
		path, sections, ok := selectedManifestBuffer(solid.Resources.Buffers)
		if !ok {
			continue
		}
		payload := buffers[path]
		indexSection, hasIndices := findBufferSection(sections, "indices")
		positionSection, hasPositions := findBufferSection(sections, "position", "positions", "nodePositions")
		if !hasIndices || !hasPositions || indexSection.DType != "uint32" || positionSection.DType != "float32" || positionSection.Dimension < 3 || positionSection.Dimension > 4 {
			continue
		}
		for _, location := range face.Properties.BufferLocations.Indices {
			for offset := location.StartIndex; offset+2 < location.EndIndex; offset += 3 {
				var triangle topologyTriangle
				triangle.EntityID = face.ID
				valid := true
				for corner := 0; corner < 3; corner++ {
					vertexIndex, indexOK := readUint32Section(payload, indexSection, offset+corner)
					point, pointOK := readPosition(payload, positionSection, int(vertexIndex))
					if !indexOK || !pointOK {
						valid = false
						break
					}
					triangle.Points[corner] = point
					triangle.Vertices[corner] = quantizePoint(point, tolerance)
				}
				if !valid || triangleDegenerate(triangle, tolerance) {
					degenerate++
					continue
				}
				triangle.Bounds = triangleBounds(triangle.Points)
				triangles = append(triangles, triangle)
			}
		}
	}
	return triangles, degenerate
}

func readPosition(payload []byte, section manifestBufferSection, vertexIndex int) ([3]float64, bool) {
	stride := section.Dimension * 4
	offset := section.Offset + vertexIndex*stride
	end := section.Offset + section.Length
	if vertexIndex < 0 || stride < 12 || section.Offset < 0 || section.Length < 0 || offset < section.Offset || offset+12 > end || offset+12 > len(payload) {
		return [3]float64{}, false
	}
	point := [3]float64{}
	for axis := 0; axis < 3; axis++ {
		point[axis] = float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[offset+axis*4 : offset+axis*4+4])))
		if math.IsNaN(point[axis]) || math.IsInf(point[axis], 0) {
			return [3]float64{}, false
		}
	}
	return point, true
}

func quantizePoint(point [3]float64, tolerance float64) topologyVertex {
	return topologyVertex{
		X: int64(math.Round(point[0] / tolerance)),
		Y: int64(math.Round(point[1] / tolerance)),
		Z: int64(math.Round(point[2] / tolerance)),
	}
}

func canonicalEdge(left, right topologyVertex) topologyEdge {
	if vertexLess(right, left) {
		left, right = right, left
	}
	return topologyEdge{A: left, B: right}
}

func vertexLess(left, right topologyVertex) bool {
	if left.X != right.X {
		return left.X < right.X
	}
	if left.Y != right.Y {
		return left.Y < right.Y
	}
	return left.Z < right.Z
}

func triangleDegenerate(triangle topologyTriangle, tolerance float64) bool {
	if triangle.Vertices[0] == triangle.Vertices[1] || triangle.Vertices[1] == triangle.Vertices[2] || triangle.Vertices[2] == triangle.Vertices[0] {
		return true
	}
	a := subtract(triangle.Points[1], triangle.Points[0])
	b := subtract(triangle.Points[2], triangle.Points[0])
	return vectorLength(cross(a, b)) <= tolerance*tolerance
}

func triangleBounds(points [3][3]float64) topologyBounds {
	bounds := topologyBounds{Min: points[0], Max: points[0]}
	for index := 1; index < 3; index++ {
		for axis := 0; axis < 3; axis++ {
			bounds.Min[axis] = math.Min(bounds.Min[axis], points[index][axis])
			bounds.Max[axis] = math.Max(bounds.Max[axis], points[index][axis])
		}
	}
	return bounds
}

func newUnionFind(size int) *unionFind {
	parent := make([]int, size)
	for index := range parent {
		parent[index] = index
	}
	return &unionFind{parent: parent, rank: make([]uint8, size)}
}

func (u *unionFind) find(value int) int {
	for u.parent[value] != value {
		u.parent[value] = u.parent[u.parent[value]]
		value = u.parent[value]
	}
	return value
}

func (u *unionFind) union(left, right int) {
	leftRoot, rightRoot := u.find(left), u.find(right)
	if leftRoot == rightRoot {
		return
	}
	if u.rank[leftRoot] < u.rank[rightRoot] {
		leftRoot, rightRoot = rightRoot, leftRoot
	}
	u.parent[rightRoot] = leftRoot
	if u.rank[leftRoot] == u.rank[rightRoot] {
		u.rank[leftRoot]++
	}
}

func findSelfIntersections(triangles []topologyTriangle, tolerance float64) (int, []string, int, string) {
	indices := make([]int, len(triangles))
	for index := range indices {
		indices[index] = index
	}
	root := buildBVH(triangles, indices)
	pairs := [][2]int{}
	exhausted := collectBVHPairs(root, root, true, triangles, tolerance, &pairs)
	if exhausted {
		return 0, nil, len(pairs), "unknown"
	}
	count := 0
	entities := map[string]struct{}{}
	for _, pair := range pairs {
		left, right := triangles[pair[0]], triangles[pair[1]]
		if trianglesShareVertex(left, right) {
			continue
		}
		if triangleSATIntersects(left.Points, right.Points, tolerance) {
			count++
			entities[left.EntityID] = struct{}{}
			entities[right.EntityID] = struct{}{}
		}
	}
	return count, sortedEntitySet(entities), len(pairs), "ready"
}

func buildBVH(triangles []topologyTriangle, indices []int) *bvhNode {
	node := &bvhNode{Bounds: triangles[indices[0]].Bounds}
	for _, index := range indices[1:] {
		node.Bounds = mergeBounds(node.Bounds, triangles[index].Bounds)
	}
	if len(indices) <= bvhLeafSize {
		node.Items = append([]int(nil), indices...)
		return node
	}
	axis := longestAxis(node.Bounds)
	sort.Slice(indices, func(left, right int) bool {
		return boundsCenter(triangles[indices[left]].Bounds, axis) < boundsCenter(triangles[indices[right]].Bounds, axis)
	})
	middle := len(indices) / 2
	node.Left = buildBVH(triangles, append([]int(nil), indices[:middle]...))
	node.Right = buildBVH(triangles, append([]int(nil), indices[middle:]...))
	return node
}

func collectBVHPairs(left, right *bvhNode, same bool, triangles []topologyTriangle, tolerance float64, pairs *[][2]int) bool {
	if left == nil || right == nil || !boundsOverlap(left.Bounds, right.Bounds, tolerance) {
		return false
	}
	leftLeaf, rightLeaf := len(left.Items) > 0, len(right.Items) > 0
	if leftLeaf && rightLeaf {
		for leftIndex, leftItem := range left.Items {
			start := 0
			if same {
				start = leftIndex + 1
			}
			for rightIndex := start; rightIndex < len(right.Items); rightIndex++ {
				rightItem := right.Items[rightIndex]
				if leftItem == rightItem || !boundsOverlap(triangles[leftItem].Bounds, triangles[rightItem].Bounds, tolerance) {
					continue
				}
				if len(*pairs) >= maxIntersectionPairs {
					return true
				}
				*pairs = append(*pairs, [2]int{leftItem, rightItem})
			}
		}
		return false
	}
	if same {
		return collectBVHPairs(left.Left, left.Left, true, triangles, tolerance, pairs) ||
			collectBVHPairs(left.Right, left.Right, true, triangles, tolerance, pairs) ||
			collectBVHPairs(left.Left, left.Right, false, triangles, tolerance, pairs)
	}
	if rightLeaf || (!leftLeaf && boundsVolume(left.Bounds) >= boundsVolume(right.Bounds)) {
		return collectBVHPairs(left.Left, right, false, triangles, tolerance, pairs) ||
			collectBVHPairs(left.Right, right, false, triangles, tolerance, pairs)
	}
	return collectBVHPairs(left, right.Left, false, triangles, tolerance, pairs) ||
		collectBVHPairs(left, right.Right, false, triangles, tolerance, pairs)
}

func trianglesShareVertex(left, right topologyTriangle) bool {
	for _, leftVertex := range left.Vertices {
		for _, rightVertex := range right.Vertices {
			if leftVertex == rightVertex {
				return true
			}
		}
	}
	return false
}

func triangleSATIntersects(left, right [3][3]float64, tolerance float64) bool {
	leftEdges := [3][3]float64{subtract(left[1], left[0]), subtract(left[2], left[1]), subtract(left[0], left[2])}
	rightEdges := [3][3]float64{subtract(right[1], right[0]), subtract(right[2], right[1]), subtract(right[0], right[2])}
	leftNormal := cross(leftEdges[0], leftEdges[1])
	rightNormal := cross(rightEdges[0], rightEdges[1])
	axes := make([][3]float64, 0, 17)
	axes = append(axes, leftNormal, rightNormal)
	for _, leftEdge := range leftEdges {
		for _, rightEdge := range rightEdges {
			axes = append(axes, cross(leftEdge, rightEdge))
		}
		axes = append(axes, cross(leftNormal, leftEdge))
	}
	for _, rightEdge := range rightEdges {
		axes = append(axes, cross(rightNormal, rightEdge))
	}
	for _, axis := range axes {
		length := vectorLength(axis)
		if length <= tolerance {
			continue
		}
		for index := range axis {
			axis[index] /= length
		}
		leftMin, leftMax := projectTriangle(left, axis)
		rightMin, rightMax := projectTriangle(right, axis)
		if leftMax < rightMin-tolerance || rightMax < leftMin-tolerance {
			return false
		}
	}
	return true
}

func projectTriangle(triangle [3][3]float64, axis [3]float64) (float64, float64) {
	minimum := dot(triangle[0], axis)
	maximum := minimum
	for index := 1; index < 3; index++ {
		projection := dot(triangle[index], axis)
		minimum = math.Min(minimum, projection)
		maximum = math.Max(maximum, projection)
	}
	return minimum, maximum
}

func mergeBounds(left, right topologyBounds) topologyBounds {
	for axis := 0; axis < 3; axis++ {
		left.Min[axis] = math.Min(left.Min[axis], right.Min[axis])
		left.Max[axis] = math.Max(left.Max[axis], right.Max[axis])
	}
	return left
}

func boundsOverlap(left, right topologyBounds, tolerance float64) bool {
	for axis := 0; axis < 3; axis++ {
		if left.Max[axis] < right.Min[axis]-tolerance || right.Max[axis] < left.Min[axis]-tolerance {
			return false
		}
	}
	return true
}

func longestAxis(bounds topologyBounds) int {
	axis := 0
	for candidate := 1; candidate < 3; candidate++ {
		if bounds.Max[candidate]-bounds.Min[candidate] > bounds.Max[axis]-bounds.Min[axis] {
			axis = candidate
		}
	}
	return axis
}

func boundsCenter(bounds topologyBounds, axis int) float64 {
	return (bounds.Min[axis] + bounds.Max[axis]) * 0.5
}

func boundsVolume(bounds topologyBounds) float64 {
	volume := 1.0
	for axis := 0; axis < 3; axis++ {
		volume *= math.Max(0, bounds.Max[axis]-bounds.Min[axis])
	}
	return volume
}

func subtract(left, right [3]float64) [3]float64 {
	return [3]float64{left[0] - right[0], left[1] - right[1], left[2] - right[2]}
}

func cross(left, right [3]float64) [3]float64 {
	return [3]float64{
		left[1]*right[2] - left[2]*right[1],
		left[2]*right[0] - left[0]*right[2],
		left[0]*right[1] - left[1]*right[0],
	}
}

func dot(left, right [3]float64) float64 {
	return left[0]*right[0] + left[1]*right[1] + left[2]*right[2]
}

func vectorLength(vector [3]float64) float64 {
	return math.Sqrt(dot(vector, vector))
}

func mergeEntitySet(target, source map[string]struct{}) {
	for entity := range source {
		if entity != "" {
			target[entity] = struct{}{}
		}
	}
}

func sortedEntitySet(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		if value != "" {
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}

func formatInteger(value int) string {
	return fmt.Sprintf("%d", value)
}
