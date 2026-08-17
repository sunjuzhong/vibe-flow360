# T10 — Modular snappy surface meshing

This tutorial adapts Flow360's official `cube_snappy` example into a finned heat-sink decision problem. It compares a global-only snappy setup with a feature-aware variant using BodyRefinement, RegionRefinement, and SurfaceEdgeRefinement.

Run `python3 tutorials/T10-snappy-surface-meshing/build_simulation.py --check` to reproduce both parameter artifacts. The Web tutorial creates one Geometry Project and two configured SurfaceMesh Drafts; it does not submit mesh compute.
