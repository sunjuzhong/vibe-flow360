# T06 expected review

The automatic Project contains a body-only Geometry and two VolumeMesh Drafts. Both register the rotor service CustomVolume and its bounding Cylinder; only `AutomatedFarfield.relative_size` changes from 20 to 8.

The manual Project contains the closed external fluid domain. Its VolumeMesh Draft uses `UserDefinedFarfield`; the standard mesher infers the full-body domain from geometry bounds that cross y = 0. It is not created by patching the body-only Project.

Before any solver Case, review Geometry topology, outer-boundary surface groups, enclosed-entity registration, normalized distances, projected blockage, and volume-cell growth. Accepting the compact domain additionally requires matched drag, pressure, and wake evidence against the 20D baseline.
