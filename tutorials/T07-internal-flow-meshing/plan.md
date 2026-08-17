# T07 execution plan

## Local and Web preparation

1. Import `assets/internal-flow.csm` as a metre-based Geometry.
2. Group faces using the `faceName` attribute.
3. Confirm that the body is the fluid volume and that inlet, outlet, floor,
   ceiling, sphere, supports, and floor-adjacent faces are present.
4. Register `Primary duct fluid` at `[1, 0, 2] m` and verify it is referenced by
   `CustomZones`.
5. Create the global-only and feature-aware VolumeMesh Drafts.
6. Inspect the semantic diff before approving any remote mesh generation.

## Optional cloud work

If cloud execution is approved separately, generate both meshes and review the
same sections for topology, feature survival, layers, transition quality,
outlet recovery, cell count, and worst-quality regions. Do not create a solver
Case until the mesh evidence contract passes.
