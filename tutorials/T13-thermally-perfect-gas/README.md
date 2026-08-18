# T13 — Thermally perfect frozen gas

T13 models a 50 mm probe in a 1800 K, 900 m/s turbine-exhaust stream. It compares the pinned Flow360 25.10.3 constant-gamma Air model with a fixed-composition N2/O2 mixture using two-range NASA-9 thermodynamic polynomials. Sutherland viscosity, geometry, flow state, mesh, wall temperature, solver, and outputs remain fixed.

Run `python3 tutorials/T13-thermally-perfect-gas/build_simulation.py --check` to reproduce both artifacts. The Web tutorial creates one Geometry Project and two configured Case Drafts without submitting mesh or solver compute.

Flow360 25.10.3 does not expose `Species` or `SpeciesTransportModel`; this tutorial therefore does not claim variable-composition transport or chemistry. `FrozenSpecies` mass fractions are material inputs, not transported solution fields.
