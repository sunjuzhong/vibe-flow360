# T06 execution plan

1. Confirm the body diameter is 1 m and the expected freestream points along positive x.
2. Select the CAD contract: body-only geometry for automatic generation or a watertight fluid volume for explicit boundary placement.
3. For the automatic path, review `relative_size`, bounding-box domain detection, and the registered protected-wake Cylinder in `enclosed_entities`.
4. For the manual path, review outer-boundary topology, 10D upstream/25D downstream/12D lateral extents, and projected blockage.
5. Create the selected Project and configured VolumeMesh Drafts from the Web page.
6. Open each Draft, confirm parameter synchronization, and run preflight.
7. If cloud meshing is approved separately, compare boundary distance, volume-cell growth, and wake coverage.
8. A solver comparison may use the compact automatic domain only after drag, pressure, and wake evidence agrees with the 20D baseline within the declared tolerance.
