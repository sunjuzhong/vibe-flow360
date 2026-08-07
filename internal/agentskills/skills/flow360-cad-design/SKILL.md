---
name: flow360-cad-design
description: Design exact CAD and CFD domain topology for Flow360 AI Create. Use when translating a natural-language simulation goal into CadQuery/OpenCascade geometry, semantic face groups, farfield or wind-tunnel domains, obstacle booleans, and downstream boundary intent before STEP generation.
---

# Flow360 CAD Design

Design geometry for the complete CFD workflow, not only for a successful CAD export.

1. Identify the physical region being solved: external fluid, internal fluid, or solid/fluid multi-region. Construct that region explicitly with boolean operations.
2. Ask only for dimensions or topology choices that materially change the physics. For an introductory or baseline request, select defensible scales and record them as assumptions.
3. Produce exact closed B-rep bodies. Give every resulting face exactly one stable semantic role; reject gaps, overlaps, coincident faces, and accidental caps.
4. Separate CAD surface names from Flow360-generated ghost boundaries. Treat imported entity metadata as authoritative after Project creation.
5. Design boundary intent as a total partition: every physical and ghost boundary must eventually belong to exactly one compatible Flow360 boundary-condition model.
6. Do not infer periodic compatibility from CAD alone. Use symmetry for a safe finite-span baseline unless a reviewed conformal mesh proves a valid periodic pair.
7. Validate STEP round-trip topology, named-face coverage, body count, bounds, and volume before upload. After import, reconcile generated names against actual Flow360 entity IDs.

Never encode a benchmark-specific body, dimension, or boundary name as a universal rule. Use the user's goal, generated topology, imported entities, and live schema as evidence.
