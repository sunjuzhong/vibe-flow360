---
name: flow360-external-aero-cad
description: Design and repair exact external-aerodynamics CAD for Flow360, including isolated bodies, finite-span or symmetry models, farfield domains, and domain-minus-obstacle booleans. Use for external-flow AI Create requests and whenever an external-fluid CadQuery/OpenCascade operation fails topology validation.
---

# Flow360 External Aero CAD

Construct the physical fluid region deliberately. Do not treat a successful boolean call as evidence of a valid CFD domain.

1. Build and validate the obstacle as a closed positive-volume solid before creating the domain. Prefer simple monotone profiles. For a revolved pointed body, close the profile on the axis and use a finite trailing radius when an exact zero-radius tip produces a degenerate edge.
2. Build the farfield as a separate positive-volume solid. Place the obstacle using explicit transforms; do not rely on differing primitive origins.
3. Use exactly one final `cut` for the external fluid and declare `domain_relationship`:
   - `enclosed`: the obstacle is strictly inside the domain on all axes.
   - `span-through`: the obstacle intentionally spans both domain sides on exactly one axis and is strictly inside on the other two.
   - `symmetry-half`: a half-model intentionally touches exactly one symmetry plane and is strictly inside elsewhere.
4. Never select a relationship merely to silence validation. If bounds do not match the intended relationship, correct dimensions or placement before cutting.
5. Avoid unintended tangency, coincident outer faces, self-intersecting splines, duplicate booleans, and features near the modelling tolerance.
6. Partition every resulting face exactly once. Name the obstacle cavity as a wall and distinguish farfield, inlet/outlet, and intentional symmetry planes. Do not invent periodic pairs.
7. On failure, preserve confirmed engineering dimensions and repair only the failing operation first. Read the structured diagnostic code, operation ID, operand bounds, volumes, and axis relationships. Change topology strategy when the same failure code repeats; do not make cosmetic edits and retry unchanged geometry.

Emit the exact `cadquery-dsl-v1` wire shape. Every operation is `{id, op, params}`. For this workflow:

- `box` params are `{length, width, height}`; the primitive is centred.
- `revolve` params are `{profile:[[radius, axial], ...], profile_type, angle, axis:"z"}`. Close the profile on radius zero.
- `rotate` params are `{source, axis_start:[x,y,z], axis_end:[x,y,z], angle}`.
- `translate` params are `{source, vector:[x,y,z]}`.
- `cut` params are `{left, right, domain_relationship}`.
- Return named `results` with `{source, name, faces:[{name, selector}]}`.
- Each face assignment must use one exact supported selector: `>X`, `<X`, `>Y`, `<Y`, `>Z`, `<Z`, `|X`, `|Y`, `|Z`, `%PLANE`, `%CYLINDER`, `%CONE`, `%SPHERE`, `%TORUS`, `%BEZIER`, `%BSPLINE`, `%REVOLUTION`, `%EXTRUSION`, or `%OFFSET`. Boolean combinations such as `not (...)` and `A or B` are invalid. A revolved spline cavity normally uses `%REVOLUTION`.

Do not emit axis objects, box min/max corners, `input`, `base`, `tool`, generated-by selectors, or any other unsupported convenience fields.

For an isolated water-drop baseline, prefer a closed revolved solid strictly enclosed in a substantially larger farfield and use `domain_relationship: "enclosed"`.
