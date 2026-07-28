package agent

import (
	"strings"
	"testing"
)

func TestLocalPlanIncludesGeometryAndSafetyBoundary(t *testing.T) {
	result := localPlan(ChatRequest{
		Message:  "分析机翼在 45 m/s 下的升阻力",
		Geometry: "wing.step",
	})

	for _, expected := range []string{"wing.step", "外流场空气动力学", "尚未创建或提交任何"} {
		if !strings.Contains(result, expected) {
			t.Fatalf("local plan does not contain %q: %s", expected, result)
		}
	}
}

func TestLocalPlanClassifiesInternalFlow(t *testing.T) {
	result := localPlan(ChatRequest{Message: "计算这个管道的压降"})
	if !strings.Contains(result, "内流场分析") {
		t.Fatalf("expected internal-flow classification: %s", result)
	}
}
