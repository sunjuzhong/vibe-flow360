# T14 — RANS turbulence-model sensitivity

This tutorial compares Spalart–Allmaras with k-omega SST on the same rear-step bluff body at 30 m/s. The comparison is intentionally controlled around the closure and its compatible freestream turbulence quantities.

The two Drafts are starting points for an evidence-based sensitivity study. Neither model is declared correct without experimental or higher-fidelity reference data, mesh sensitivity, and converged observables.

Run `python3 build_simulation.py --check` to verify the deterministic Flow360 artifacts.
