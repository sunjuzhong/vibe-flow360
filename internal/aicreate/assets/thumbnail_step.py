import sys
import re
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
    "strokeWidth": 1.35,
    "strokeColor": (55, 65, 47),
})

# CadQuery emits stroke widths inside the model-space scale transform. Without
# a non-scaling stroke, large parts turn a nominal 1 px outline into a black
# silhouette. Keep the drawing crisp at every engineering scale and give the
# transparent SVG a quiet CAD-canvas background.
svg = svg.replace(
    ">\n    <g transform=",
    ">\n    <defs>\n"
    "      <linearGradient id=\"cad-bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n"
    "        <stop offset=\"0%\" stop-color=\"#f8faf4\"/>\n"
    "        <stop offset=\"100%\" stop-color=\"#edf1e7\"/>\n"
    "      </linearGradient>\n"
    "    </defs>\n"
    "    <rect width=\"100%\" height=\"100%\" rx=\"18\" fill=\"url(#cad-bg)\"/>\n"
    "    <g transform=",
    1,
)
svg = svg.replace(
    "<path ",
    '<path vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" ',
)

# getSVG fits the model but anchors it to the configured top-left margin. Read
# the projected path bounds and retain CadQuery's safe scale while translating
# the drawing to the center of the thumbnail canvas.
number = r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?"
points = [
    (float(x), float(y))
    for path_data in re.findall(r'\bd="([^"]+)"', svg)
    for x, y in re.findall(rf"({number})\s*,\s*({number})", path_data)
]
scale_match = re.search(r'transform="scale\(([^,]+),\s*[^)]+\)', svg)
if points and scale_match:
    scale = float(scale_match.group(1))
    min_x, max_x = min(x for x, _ in points), max(x for x, _ in points)
    min_y, max_y = min(y for _, y in points), max(y for _, y in points)
    center_x, center_y = (min_x + max_x) / 2, (min_y + max_y) / 2
    centered = (
        f'transform="translate(360 240) scale({scale}, {-scale}) '
        f'translate({-center_x}, {-center_y})"'
    )
    svg = re.sub(r'transform="scale\([^"]+\)\s+translate\([^"]+\)"', centered, svg, count=1)

with open(output, "w", encoding="utf-8") as handle:
    handle.write(svg)
