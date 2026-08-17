# T10 expected report

Compare the global-only and feature-aware SurfaceMesh resources in identical views. Record surface-cell count, connected components, holes, non-manifold edges, self-intersections, maximum non-orthogonality, boundary skewness, all six fin thicknesses, and all five channel widths.

Accept the feature-aware setup only when its added cells remain concentrated near the heat sink and produce measurable preservation of fin roots, tips, faces, and open channels without violating the configured quality limits.

Do not continue to volume meshing when either surface is not watertight or when the Geometry group catalog cannot resolve the exact body and fin entities used by its refinements.
