# Draft Form Flow360 schema coverage

Acceptance record for the Draft Form projection of the installed Flow360
`SimulationParams` schema. It records what the Form covers today, how to
reproduce the checks, and the gaps that are still open, so a later change that
quietly drops a public property back to raw JSON fails a test instead of
shipping.

Recorded against Flow360 runtime `25-10-18` (`flow360_schema` 25.10.18).

## What the Form must cover

The Draft Form is a projection of the whole public `SimulationParams` tree, not
a curated list of commonly used knobs. Every public root group and every nested
property below it must be visible and editable with a real control:

- `meshing`, `models`, `operating_condition`, `outputs`, `reference_geometry`,
  `run_control`, `time_stepping`, `user_defined_dynamics`, `user_defined_fields`.

Two families stay outside the Form by design and must keep round-tripping
untouched through the canonical document and the JSON tab:

- `version` and `unit_system` — the document/runtime context. Editing them would
  make a Draft incompatible with its remote Flow360 context.
- `private_attribute_*` — Flow360-internal entity cache.

## Reproducible checks

```bash
# Installed-schema projection, root coverage, and the raw-JSON leaf budget
VIBESIM_TEST_FLOW360_SCHEMA=1 go test ./internal/flow360 \
  -run 'TestInstalledSchemaDraftFormExposesEveryPublicRootGroup|TestPreflightSimulationParamsWithInstalledSchema' \
  -count=1

# SchemaForm control behaviour and canonical round-trip
cd web && npm ci && npm test -- --run \
  src/components/SchemaForm.test.ts src/components/SchemaForm.dom.test.tsx
```

`TestInstalledSchemaDraftFormExposesEveryPublicRootGroup` walks the projected
editor schemas the same way `SchemaForm` does — object properties, array items,
union variants, quantity value schemas — and fails when:

- a public root group is missing from the projection;
- `version`, `unit_system`, or any `private_attribute_*` becomes a Form control;
- the number of leaf nodes that still render as an unconstrained raw-JSON editor
  exceeds `draftFormJSONLeafBudget`.

## Current result

| Check | Result |
| --- | --- |
| Public root groups present | 9 / 9 |
| `version` / `unit_system` / `private_attribute_*` exposed as controls | none |
| Raw-JSON leaf budget (representative Geometry→Case projection) | 46 / 60 |
| Quantity units + `unit_options` / `unit_aliases` | projected |
| Typed `Expression` wire discriminator + function suggestions | projected |
| Entity lists with canonical payloads | projected |
| Canonical serialize → validate → read round-trip | lossless on the locally valid tutorials |

Because the projection is derived from the installed schema rather than a fixed
path list, the Form no longer shrinks when a tutorial happens not to set a
cluster of fields: the same root groups and the same leaf count are produced for
every representative input.

## Open gaps

Raw-JSON leaves use the schema `json` type and render as a plain text editor.
46 remain, and they fall into two groups:

- Fixed-length numeric tuples and colors — directions, rotation axes, camera
  vectors, scale, RGB/RGBA. These have a natural structured control (labelled
  X/Y/Z or R/G/B/A component inputs) and should stop being JSON text.
- Genuinely unconstrained values — free-form maps and fields the upstream schema
  does not constrain. These stay JSON, but the Form must label them as JSON-only
  rather than presenting them as ordinary inputs.

## Change checklist

1. When a public property is added to Flow360, it must appear in the Form with no
   manual path entry — the projection derives it, and the root-group test guards
   it.
2. Do not add a fixed path list. A whitelist silently hides controls whenever
   Flow360 adds a field or a model variant carries a less common configuration.
3. Do not widen the raw-JSON budget to make a projection change pass. A new JSON
   leaf is a control gap; either give it a structured control or document why the
   value is unconstrained.
