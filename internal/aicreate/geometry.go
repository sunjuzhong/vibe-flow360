package aicreate

import (
	"fmt"
	"io"
	"math"
)

type point struct{ x, y, z float64 }

// WriteCylinderSTL writes a watertight, triangulated cylinder aligned to Z.
func WriteCylinderSTL(w io.Writer, geometry Geometry) error {
	if geometry.DiameterM <= 0 || geometry.SpanM <= 0 || geometry.Segments < 8 {
		return fmt.Errorf("invalid cylinder geometry")
	}
	if _, err := fmt.Fprintln(w, "solid ai_create_cylinder"); err != nil {
		return err
	}
	radius, half := geometry.DiameterM/2, geometry.SpanM/2
	topCenter, bottomCenter := point{z: half}, point{z: -half}
	for i := 0; i < geometry.Segments; i++ {
		a0 := 2 * math.Pi * float64(i) / float64(geometry.Segments)
		a1 := 2 * math.Pi * float64(i+1) / float64(geometry.Segments)
		b0 := point{x: radius * math.Cos(a0), y: radius * math.Sin(a0), z: -half}
		b1 := point{x: radius * math.Cos(a1), y: radius * math.Sin(a1), z: -half}
		t0 := point{x: b0.x, y: b0.y, z: half}
		t1 := point{x: b1.x, y: b1.y, z: half}
		for _, triangle := range [][3]point{{b0, b1, t1}, {b0, t1, t0}, {topCenter, t0, t1}, {bottomCenter, b1, b0}} {
			if err := writeFacet(w, triangle); err != nil {
				return err
			}
		}
	}
	_, err := fmt.Fprintln(w, "endsolid ai_create_cylinder")
	return err
}

func writeFacet(w io.Writer, triangle [3]point) error {
	a, b, c := triangle[0], triangle[1], triangle[2]
	u := point{x: b.x - a.x, y: b.y - a.y, z: b.z - a.z}
	v := point{x: c.x - a.x, y: c.y - a.y, z: c.z - a.z}
	n := point{x: u.y*v.z - u.z*v.y, y: u.z*v.x - u.x*v.z, z: u.x*v.y - u.y*v.x}
	length := math.Sqrt(n.x*n.x + n.y*n.y + n.z*n.z)
	if length > 0 {
		n.x /= length
		n.y /= length
		n.z /= length
	}
	_, err := fmt.Fprintf(w, "  facet normal %.9g %.9g %.9g\n    outer loop\n      vertex %.9g %.9g %.9g\n      vertex %.9g %.9g %.9g\n      vertex %.9g %.9g %.9g\n    endloop\n  endfacet\n",
		n.x, n.y, n.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
	return err
}
