---
name: flow360-preflight-repair
description: Repair Flow360 SimulationParams after schema validation or preflight failure. Use when AI Create receives missing fields, forbidden fields, invalid variants, incomplete boundary coverage, entity-assignment errors, or other stage-specific validator diagnostics.
---

# Flow360 Preflight Repair

Treat repair as a monotonic evidence-driven loop.

1. Read every issue's code, path, stage, and message together with the recovery schema generated for the current candidate.
2. Apply high-confidence deterministic recommendations first, including entity assignments and field removals. These corrections are authoritative mechanical fixes.
3. Accumulate corrections across attempts. Merge each new repair over the current candidate; never replace the candidate with a fresh patch that forgets already validated changes. Use explicit null tombstones for requested removals.
4. Re-run preflight after each merge. Keep all corrections that remain schema-valid, and pass the latest merged SimulationParams plus remaining issues to the next attempt.
5. For unassigned boundaries, use recovery-schema model choices and entity payloads. Cover all reported entities exactly once; never guess IDs from display names or hardcode a particular boundary name.
6. For union or discriminator errors, select a current schema variant and emit only its declared children. For forbidden fields, remove the exact path rather than renaming it from memory.
7. Stop and ask the user only for unresolved physical intent. Schema wiring, boundary coverage, field removal, and entity selection are Agent responsibilities.

Success means the real Flow360 preflight is valid. A plausible explanation or locally valid JSON is not sufficient.
