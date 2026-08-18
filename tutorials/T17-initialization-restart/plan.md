# Execution plan

## Phase A — create the controlled comparison

Create the bundled Geometry Project and the three configured Drafts. Run the 8° source first. The 12° cold-start and analytic-seed Drafts are independent comparisons and do not require a parent Case.

## Phase B — establish a parent solution

Accept the source only after residual, force, surface-pressure, state-bound, and mesh evidence pass. A terminal status alone does not make the Case a trustworthy parent.

## Phase C — create the restart branch

From the accepted source Case, choose Fork/New run in the Project tree. Change the target condition to 12° and apply the `target-modified-restart` patch. The expressions rotate the parent velocity by 4° while preserving its density and pressure fields.

## Phase D — compare initialization cost and independence

Compare pseudo-step count, wall time, startup extrema, force histories, and final fields among cold start, expression seed, and fork. Accept acceleration only when the final 12° observables agree within the declared tolerance.

## Cross-mesh interpolation

Use interpolation only when the target is a different Volume Mesh. Record the parent Case and target mesh IDs, verify overlapping domains and compatible physical regions, then inspect conservation and local extrema after transfer. A same-mesh fork does not require interpolation.
