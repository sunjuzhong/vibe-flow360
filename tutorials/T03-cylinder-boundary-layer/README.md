# T03 — Curvature-sensitive cylinder mesh

T03 teaches how global meshing defaults, local surface refinement, and a
boundary-layer refinement work together around a three-dimensional cylinder.
It adapts Flow360's `steady_3D_cylinder.py` example but stops at the mesh
decision boundary so users can inspect geometry and mesh evidence before a
solver Case exists.

The baseline uses a 0.25 m local maximum edge length, 10° curvature resolution,
0.01 m first layer, and 1.2 growth rate. The controlled variant tightens those
three spatial controls while preserving geometry, farfield, and mesher choice.

Use the browser lesson at `/tutorials/T03`. The final action creates a Geometry
Project and two fully configured Flow360 VolumeMesh Drafts. It does not submit
cloud meshing automatically.
