# Flow360 tutorial coverage registry

This directory is the machine-verifiable source of truth for tutorial coverage.

- `flow360-version.json` pins the Flow360 API and package version.
- `feature-registry.json` is the deterministic snapshot exported from the pinned
  `SimulationParams` JSON Schema plus the supported workflow/result registry.
- `capabilities.json` lists public workflows and result-reading capabilities
  that do not come from `SimulationParams`.
- `coverage.yaml` maps every public feature to a tutorial section, or excludes
  generated/private implementation details with a reason.

Run the gate locally with:

```bash
make tutorials-coverage
```

When upgrading Flow360, install the exact new package version, update
`flow360-version.json`, and regenerate the registry:

```bash
make tutorials-registry
make tutorials-coverage
```

The coverage gate reports four disjoint states:

- `covered`: assigned to a tutorial but its artifact is still planned;
- `verified`: assigned to a tutorial and backed by an existing validated artifact;
- `missing`: public and neither mapped nor excluded (the gate fails);
- `excluded`: intentionally outside the tutorial contract, with a documented reason.

A mapping may be changed from `planned` to `verified` only when it names an
`artifact` committed in this repository. Artifact deserialization and stage
validation are added with the tutorial that owns it.
