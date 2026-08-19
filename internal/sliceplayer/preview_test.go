package sliceplayer

import "testing"

func TestClusterPreviewTopologyKeepsSliceConnected(t *testing.T) {
	const width, height = 161, 121
	positions := make([]float32, 0, width*height*3)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			positions = append(positions, float32(x), float32(y), 0)
		}
	}
	indices := make([]uint32, 0, (width-1)*(height-1)*6)
	for y := 0; y < height-1; y++ {
		for x := 0; x < width-1; x++ {
			a := uint32(y*width + x)
			b := a + 1
			c := a + uint32(width)
			d := c + 1
			indices = append(indices, a, b, d, a, d, c)
		}
	}

	representatives, preview, err := clusterPreviewTopology(
		indices,
		positions,
		[2][3]float64{{0, 0, 0}, {width - 1, height - 1, 0}},
		10_000,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if triangles := len(preview) / 3; triangles == 0 || triangles > 10_000 || triangles >= len(indices)/3 {
		t.Fatalf("unexpected preview triangle count: %d", triangles)
	}
	for _, vertex := range preview {
		if int(vertex) >= len(representatives) {
			t.Fatalf("preview references missing vertex %d of %d", vertex, len(representatives))
		}
	}

	// A planar slice should remain one connected surface after simplification.
	trianglesByVertex := make([][]int, len(representatives))
	for offset := 0; offset < len(preview); offset += 3 {
		triangle := offset / 3
		for component := 0; component < 3; component++ {
			vertex := preview[offset+component]
			trianglesByVertex[vertex] = append(trianglesByVertex[vertex], triangle)
		}
	}
	visited := make([]bool, len(preview)/3)
	queue := []int{0}
	visited[0] = true
	for len(queue) > 0 {
		triangle := queue[0]
		queue = queue[1:]
		for component := 0; component < 3; component++ {
			for _, neighbor := range trianglesByVertex[preview[triangle*3+component]] {
				if !visited[neighbor] {
					visited[neighbor] = true
					queue = append(queue, neighbor)
				}
			}
		}
	}
	for triangle, connected := range visited {
		if !connected {
			t.Fatalf("preview surface is disconnected at triangle %d", triangle)
		}
	}
}
