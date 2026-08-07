---
name: flow360-parameter-authoring
description: Author coherent Flow360 SimulationParams from engineering intent and the active installed schemas. Use when AI Create configures meshing, operating conditions, physics, boundary models, time stepping, numerics, and outputs for an imported Geometry or downstream Flow360 resource.
---

# Flow360 Parameter Authoring

Treat canonical SimulationParams, imported entity metadata, and the active stage schemas as executable evidence. General CFD knowledge guides choices but never overrides those contracts.

1. Preserve the canonical baseline and emit a sparse merge patch containing only deliberate changes.
2. Use only schema-listed paths, variants, units, enums, and wire shapes. Do not echo private or discriminator fields unless the editable schema requests them.
3. Build one coherent setup: operating condition and material determine regime; regime and objective determine physics and steady/unsteady treatment; geometry scale and fidelity determine mesh controls; outputs must measure the stated objective.
4. Enforce boundary closure before completion. Compute the union of physical surfaces and generated ghost boundaries from live entity metadata, then ensure every boundary is covered exactly once by a schema-compatible model. Do not assume a wildcard covers ghost entities.
5. Prefer high-confidence schema recommendations for mechanical assignments. Preserve user-confirmed physics and record defensible autonomous defaults as assumptions.
6. Ask the user only when a missing physical choice materially changes the engineering objective and no defensible baseline exists. Never ask the user to select schema paths, discriminators, entity IDs, or repair mechanics.
7. Preflight the fully merged document, not the sparse patch alone. Create the Draft only after the merged configuration passes the real Flow360 validator.

Do not specialize the workflow to one geometry or boundary name. Derive assignments from entity type, topology, semantic role, schema choices, and preflight evidence.
