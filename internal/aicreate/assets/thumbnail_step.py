import sys
import cadquery as cq
from cadquery.occ_impl.exporters.svg import getSVG

source, output = sys.argv[1], sys.argv[2]
shape = cq.importers.importStep(source).val()
svg = getSVG(shape, {
    "width": 720,
    "height": 480,
    "marginLeft": 42,
    "marginTop": 32,
    "projectionDir": (-1.7, 1.2, 1.5),
    "showAxes": False,
    "showHidden": False,
    "strokeWidth": 1.1,
    "strokeColor": (42, 48, 35),
})
with open(output, "w", encoding="utf-8") as handle:
    handle.write(svg)
