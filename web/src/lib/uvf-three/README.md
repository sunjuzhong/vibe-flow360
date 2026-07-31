# UVF Three.js renderer

This directory implements the generic `manifest.json + binary buffers` rendering
contract. It intentionally has no knowledge of CFD stages, boundary-condition
names, solver fields, quality thresholds, or product workflows.

## Responsibilities

- validate and parse UVF manifest entries;
- resolve the default or requested LOD and its binary buffer;
- map `position`, `normal`, `indices`, edges, and arbitrary typed sections to
  Three.js geometry;
- discover scalar and vector fields from section metadata;
- aggregate declared bounds or compute finite bounds from binary values;
- apply generic colormaps, wireframe state, and entity visibility;
- expose format-level counts and lifecycle disposal.

LOD state is reported per solid entity because one manifest may contain solids
with different level counts and different defaults.

## Consumer responsibilities

Consumers decide what an entity or field means. For example, the Surface Mesh
workspace may classify a field as a mesh-quality diagnostic or join a Face ID to
a boundary condition, but those decisions must stay outside this library.

## LOD ranges

When an entity supplies one index range per LOD level, the range at the resolved
LOD index is used. A non-LOD entity, or a manifest whose ranges are not
level-aligned, keeps all declared ranges.

The legacy `Flow360UVFLoader` and `setGroupVisibility` exports remain as
compatibility aliases. New consumers should use `UVFLoader` and
`setEntityVisibility`.
