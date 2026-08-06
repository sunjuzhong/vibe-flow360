# UVF Three.js renderer

This directory implements the generic `manifest.json + binary buffers` rendering
contract. It intentionally has no knowledge of CFD stages, boundary-condition
names, solver fields, quality thresholds, or product workflows.

## Responsibilities

- validate and parse UVF manifest entries;
- resolve the default or requested LOD and its binary buffer;
- map `position`, `normal`, `indices`, edges, and arbitrary typed sections to
  Three.js geometry;
- build the `GeometryGroup → SolidGeometry → Face/Edge` scene hierarchy and
  apply declared 4×4 transforms;
- discover scalar and vector fields from section metadata;
- aggregate declared bounds or compute finite bounds from binary values;
- apply generic colormaps, wireframe state, and entity visibility;
- combine generic field-range predicates and outline matching triangles;
- expose format-level counts and lifecycle disposal.

LOD state is reported per solid entity because one manifest may contain solids
with different level counts and different defaults.

Viewer consumers may request any explicit LOD index through `UVFLoader.load()`.
An `undefined` request preserves each entity's manifest default. A global
precision selector must only expose the intersection supported by all
multi-level solid entities; single-buffer entities remain unchanged at every
selection.

Binary buffers are not subject to a small built-in byte ceiling. Deployments
that need a device-specific guard may set `VITE_UVF_MAX_BUFFER_BYTES` and
`VITE_UVF_MAX_TOTAL_BUFFER_BYTES` to positive byte counts at build time. The
server stores downloaded buffers as files, serves HTTP byte ranges, and fetches
non-default LOD files only when the viewer requests them. A monolithic buffer
must still fit the browser and GPU resources needed by Three.js; genuinely
out-of-core rendering requires a chunked manifest rather than a larger limit.

Wire display is implemented as disposable `LineSegments` layered over each
face. It never switches the fill material into Three.js `wireframe` mode, so
entity color or field coloring remains visible underneath.
Dense wire overlays are screen-space adaptive: they remain hidden while
individual triangles are sub-pixel at an overview scale and fade in as the
camera moves close enough to resolve them. This prevents distant mesh edges
from producing moiré or camouflage patterns.

## Consumer responsibilities

Consumers decide what an entity or field means. For example, the Surface Mesh
workspace may classify a field as a mesh-quality diagnostic or join a Face ID to
a boundary condition, but those decisions must stay outside this library.

## LOD ranges

When an entity supplies one index range per LOD level, the range at the resolved
LOD index is used for both faces and edges. A non-LOD entity, or a manifest
whose ranges are not level-aligned, keeps all declared ranges.

## Entity graph

Every rendered or container entry has a stable `entityId`. `UVFAsset.entities`
exposes parent and child IDs without leaking Three.js objects, while
`getEntityObject()` is available to rendering integrations. Missing group
members, cycles, duplicate parents, duplicate IDs, invalid transforms, and
out-of-bounds ranges are rejected rather than producing a partial scene.

The legacy `Flow360UVFLoader` and `setGroupVisibility` exports remain as
compatibility aliases. New consumers should use `UVFLoader` and
`setEntityVisibility`.
