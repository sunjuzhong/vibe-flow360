"""Reproduce and validate the exact cylinder STEP asset with CadQuery/OCCT."""

import math
from pathlib import Path

import cadquery as cq


output = Path(__file__).with_name("cylinder.step")
model = cq.Workplane("XY").circle(0.5).extrude(1.0)
cq.exporters.export(model, str(output), exportType="STEP")
output.write_text("\n".join(line.rstrip() for line in output.read_text().splitlines()) + "\n")

loaded = cq.importers.importStep(str(output)).val()
assert loaded.isValid()
assert len(loaded.Solids()) == 1
assert len(loaded.Faces()) == 3
assert math.isclose(loaded.Volume(), math.pi / 4, rel_tol=1e-9)
text = output.read_text()
assert "ISO-10303-21" in text
assert "CYLINDRICAL_SURFACE" in text
assert "FACET" not in text.upper()
print(f"validated {output}: 3 analytic faces, volume={loaded.Volume():.15g}")
