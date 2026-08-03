package aicreate

import (
	_ "embed"
	"fmt"
	"io"
)

// cylinderSTEP is an exact analytic B-rep encoded as ISO 10303 STEP, generated
// by CadQuery 2.6.1 with OpenCascade 7.8.1 and validated by reading it back
// through the same CAD kernel. It contains one cylindrical and two planar
// faces, not triangles.
//
//go:embed assets/cylinder.step
var cylinderSTEP []byte

func WriteCylinderSTEP(w io.Writer, geometry Geometry) error {
	if geometry.Kind != "cylinder" || geometry.DiameterM != 1 || geometry.SpanM != 1 {
		return fmt.Errorf("the embedded exact CAD template supports only a 1 m diameter × 1 m span cylinder")
	}
	if geometry.Representation != "analytic-brep" || geometry.Format != "step" || !geometry.Validated {
		return fmt.Errorf("cylinder CAD provenance is incomplete")
	}
	_, err := w.Write(cylinderSTEP)
	return err
}
