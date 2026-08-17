# T09 expected engineering review

The baseline contains one cylindrical `RotationVolume`; both stages share its
200 rpm rigid motion. The nested variant keeps that outer zone and adds a
spherical inner interface. Its `Rotation` specifies -500 rpm relative to the
outer Cylinder through `parent_volume`, so the coaxial inertial speed is
200 - 500 = -300 rpm.

At dt = 0.001 s, the outer zone advances 1.2 degrees and the inner stage moves
3.0 degrees relative to its parent per step. Acceptance still requires entity
registration, geometric containment, interface clearance and quality, flux
conservation, temporal sensitivity, continuous wakes, and stable loads. No
result is claimed until cloud meshes and Cases are separately approved and run.
