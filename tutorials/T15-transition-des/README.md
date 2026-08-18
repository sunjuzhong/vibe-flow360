# T15 — transition and DES model-upgrade gates

This tutorial uses one finite-span three-element wing at 16° incidence to distinguish three questions: fully turbulent steady RANS for mean loads, an amplification-factor transition model for laminar-to-turbulent onset, and DDES for statistically converged unsteady separation.

The three Drafts are not interchangeable accuracy levels. Each requires its own evidence gate, while geometry, operating condition, reference values, wall resolution, separated-flow refinement, and observables remain traceable.

Run `python3 build_simulation.py --check` to verify the deterministic Flow360 artifacts.
