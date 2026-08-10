# Flow360 tutorial coverage registry

This directory is the machine-verifiable source of truth for tutorial coverage.

- `flow360-version.json` pins the Flow360 API and package version.
- `feature-registry.json` is the deterministic snapshot exported from the pinned
  `SimulationParams` JSON Schema plus the supported workflow/result registry.
- `capabilities.json` lists public workflows and result-reading capabilities
  that do not come from `SimulationParams`.
- `coverage.yaml` maps every public feature to a tutorial section, or excludes
  generated/private implementation details with a reason.
- `schema/tutorial.schema.json` defines the contract shared by every tutorial.
- `TUTORIAL_STANDARD_V2.md` defines the required beginner learning loop.
- `schema/pedagogy.schema.json` enforces CFD concepts, Flow360 mapping,
  derivations, prediction, failure modes, evidence rubrics, and transfer checks.
- `schema/evidence.schema.json` defines machine-checkable engineering evidence.
- `schema/validation-report.schema.json` defines the ephemeral CI evidence that
  allows a coverage mapping to become `verified`.
- `validator-requirements.txt` pins the small schema/YAML validation runtime;
  the Flow360 package itself remains pinned by `flow360-version.json`.

Run the gate locally with:

```bash
make tutorials-test
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

## Available tutorial

- [T01 — First trustworthy lift and drag result](T01-first-lift-drag/README.md):
  a complete Geometry-to-Case aircraft example with a reproducible baseline,
  a 5° angle-of-attack variant, and explicit mesh/convergence/force evidence.
- [T03 — Curvature-sensitive cylinder mesh](T03-cylinder-boundary-layer/README.md):
  global meshing defaults, local SurfaceRefinement, BoundaryLayer controls, and
  browser-created baseline/refined VolumeMesh Drafts.
- [T04 — Preserve multi-element airfoil edges and gaps](T04-airfoil-edge-refinement/README.md):
  explicit edge-spacing methods, passive projection, and a Geometry AI
  alternative for thin geometry and narrow passages.
- [T05 — Place volume refinement where the wake travels](T05-wake-volume-refinement/README.md):
  near-body, structured-box, and axisymmetric volume controls aligned with
  cylinder separation and downstream wake transport.
- [T06 — Choose the external farfield domain](T06-farfield-selection/README.md):
  automatic and CAD-defined external domains, enclosed CustomVolume rules,
  normalized boundary placement, blockage, and domain-size sensitivity.

T01, T03, T04, T05, and T06 can be experienced locally without cloud execution charges:

```bash
python3 tutorials/T01-first-lift-drag/build_simulation.py --check
python3 tutorials/T03-cylinder-boundary-layer/build_simulation.py --check
python3 tutorials/T04-airfoil-edge-refinement/build_simulation.py --check
python3 tutorials/T05-wake-volume-refinement/build_simulation.py --check
python3 tutorials/T06-farfield-selection/build_simulation.py --check
make tutorials-validate
```

See its execution plan for the optional cloud submission commands.

A mapping may be changed from `planned` to `verified` only when it names an
`artifact` committed in this repository. The central validator must produce a
fresh report proving that the tutorial declares the same feature, the artifact
hash still matches, and the pinned Flow360 package deserialized and validated
the artifact at the requested stage. Validation reports live under
`.tutorial-validation/` and are deliberately not committed.

## Tutorial package contract

Use `schema/tutorial.example.yaml` as the starting point. A tutorial directory
is named `<ID>-<slug>` and contains a `tutorial.yaml` plus the artifacts it
declares. At minimum it includes:

```text
tutorials/T01-first-lift-drag/
  tutorial.yaml
  intent.yaml
  spec.yaml
  simulation.json
  plan.md
  pedagogy.yaml
  expected/evidence.yaml
```

The validator performs these checks without contacting Flow360 cloud services:

1. Validate `tutorial.yaml`, `pedagogy.yaml`, and the evidence contract against their JSON Schemas.
2. Enforce the pinned API/package version and safe repository-local paths.
3. Check every declared coverage feature against `feature-registry.json`.
4. Verify input asset SHA-256 checksums.
5. Deserialize and stage-validate the baseline `SimulationParams` using the
   public Flow360 validation service.
6. Apply each variant as an RFC 7396 JSON Merge Patch and validate the result.
7. Reject legacy v1 packages so every future tutorial follows Tutorial Standard v2.
8. Emit deterministic artifact hashes and checks for the coverage gate.
