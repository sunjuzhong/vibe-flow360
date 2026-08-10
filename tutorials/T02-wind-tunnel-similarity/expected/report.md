# T02 expected review

The ambient Draft uses `AerospaceCondition.from_mach` at Mach 0.18, 288.15 K, and 4° alpha. It serializes 61.25 m/s and 1.225 kg/m³, which gives approximately 10.1 million Reynolds number on the 2.4 m reference length.

The matched Draft uses `from_mach_reynolds` with `reynolds_mesh_unit = 2.5e6` per metre. Velocity remains 61.25 m/s while density becomes approximately 0.730 kg/m³, producing the six-million chord target and a lower dynamic pressure.

Before comparing coefficients, confirm reference geometry, stable convergence windows, Cp, yPlus, dimensional forces, and tunnel-model limitations.
