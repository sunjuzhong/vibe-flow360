"""Reproduce and validate cylinder.brep with CadQuery 2.6.1 / OCCT 7.8.1."""

import math
from pathlib import Path

import cadquery as cq


output = Path(__file__).with_name("cylinder.brep")
model = cq.Workplane("XY").circle(0.5).extrude(1.0)
cq.exporters.export(model, str(output), exportType="BREP")
output.write_text("\n".join(line.rstrip() for line in output.read_text().splitlines()) + "\n")

loaded = cq.importers.importBrep(str(output)).val()
assert loaded.isValid()
assert len(loaded.Solids()) == 1
assert len(loaded.Faces()) == 3
assert math.isclose(loaded.Volume(), math.pi / 4, rel_tol=1e-12)
assert "Triangulations 0" in output.read_text()
print(f"validated {output}: 3 analytic faces, volume={loaded.Volume():.15g}")
