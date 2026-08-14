# AI planning and review

Vibe Flow360 keeps AI assistance tied to the engineering object being reviewed.

## Conversation scope

- **Project** scope can reason across resources and Drafts in one Project.
- **Resource** scope starts from the selected Geometry, mesh, or Case.
- **Draft** scope can propose changes to the current Draft parameters.

The transcript records user messages, assistant responses, clarification
answers, errors, and proposed parameter differences.

## From intent to plan

The assistant can translate an engineering request into a local plan. A plan
records its source resource, target stage, requested intent, parameter patch,
semantic differences, validation state, and command preview.

When consequential input is missing, the assistant returns structured
clarification fields instead of silently inventing a value. Provenance labels
distinguish provided, derived, inferred, and defaulted plan values.

## Editing Draft parameters

Draft parameters can be edited in two representations:

- **Form** uses the Flow360-derived schema, including nested objects, union
  variants, quantities, expressions, and entity assignments.
- **JSON** exposes the complete SimulationParams object.

The editor preserves private or unknown Flow360 values that it does not own.
AI changes are applied as merge patches and shown as leaf-level before/after
differences.

## Preflight and approval

Preflight validates the candidate through the installed Flow360 Python schema.
The latest saved and validated revision is the only revision eligible for
review and execution.

Approving a plan freezes that revision. The assistant cannot approve it, and
approval does not silently submit it. Remote execution requires a separate user
confirmation.
