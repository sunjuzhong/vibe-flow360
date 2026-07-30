# Vibe Flow360 product brief

## Problem

Running CFD requires users to translate an engineering question into geometry
preparation, physical models, boundary conditions, mesh strategy, solver settings,
outputs, and convergence criteria. Flow360 provides the execution primitives;
Vibe Flow360 provides the reasoning interface and keeps that translation auditable.

The target user understands the object and the decision they want to make, but
does not want to manually author every simulation parameter or repeatedly navigate
the same workflow.

## Product promise

> Give Vibe Flow360 a geometry and an engineering question. It will produce a
> reviewable Flow360 plan, run it after approval, and explain whether the results
> are trustworthy and useful.

## What “vibe simulating” means

It is not “prompt in, colorful contour out.” It is a tight conversational loop:

1. State the engineering intent.
2. Let the system infer a proposed setup.
3. Resolve only consequential ambiguity.
4. Inspect assumptions, estimated fidelity, and parameter changes.
5. Run and observe.
6. Ask for a change in engineering language.

This preserves the speed of vibe coding without pretending that CFD uncertainty,
mesh quality, convergence, and physical validity do not exist.

## Personas

### Design engineer

Wants comparative answers quickly: “Which spoiler angle reduces lift without
adding more than 3% drag?”

### CFD practitioner

Wants to accelerate setup and iteration while retaining full control of generated
parameters and solver versions.

### Reviewer or lead

Wants a compact record of assumptions, convergence evidence, and differences
between variants.

## MVP golden path: external aerodynamics

Inputs:

- one geometry, surface mesh, or volume mesh file;
- reference length or confirmed geometry unit;
- velocity or Mach number;
- a goal such as drag, lift, or pressure distribution.

The planner should determine or ask for:

- fluid model and operating conditions;
- steady versus unsteady intent;
- angle of attack/yaw;
- far-field and wall semantics;
- moving ground or rotating components when relevant;
- reference area, length, and moment center;
- output quantities;
- fidelity preset and convergence criteria.

Outputs:

- `intent.yaml`: what the user asked for;
- `spec.yaml`: normalized, typed simulation intent;
- `simulation.json`: compiled Flow360 parameters;
- `plan.md`: assumptions, warnings, stages, and proposed CLI operations;
- `manifest.json`: local and remote resource IDs plus provenance;
- `report.md`: convergence assessment, requested KPIs, and limitations.

## Trust model

Classify each value in the plan:

- **provided** — explicitly stated by the user;
- **derived** — calculated deterministically from provided data;
- **inferred** — proposed by a heuristic, preset, or model;
- **defaulted** — inherited from a documented domain preset.

Block execution when:

- geometry units or scale are unresolved;
- no valid flow domain/boundary mapping is available;
- reference quantities required for requested coefficients are absent;
- incompatible physical models are selected;
- the generated config fails local or Flow360 validation.

Warn, but allow approval, when:

- mesh fidelity may be inadequate for the requested quantity;
- turbulence or transition assumptions are weak;
- convergence criteria are relaxed;
- the requested sweep could consume substantial compute.

## Architecture

The LLM-facing layer may interpret goals and phrase questions, but it must not
invoke Flow360 directly.

```text
Conversation
    ↓
Intent extractor
    ↓
Typed SimulationSpec
    ↓
Domain planner + deterministic validators
    ↓
Flow360 parameter compiler
    ↓
Approval gate
    ↓
Flow360 CLI adapter
    ↓
Manifest, monitoring, artifacts, report
```

The CLI adapter should initially shell out to the installed `flow360` command.
This keeps Vibe Flow360 aligned with supported operations:

- `flow360 project create`
- `flow360 draft create`
- `flow360 draft simulation-params set|patch|get`
- `flow360 draft run --up-to ...`
- `flow360 wait`
- `flow360 logs`
- `flow360 case results ...`

Capture structured output where available. Never parse presentation text if the
CLI can emit JSON.

## Milestones

### M0 — executable walking skeleton

- `vibesim plan` accepts a file and a plain-language goal;
- writes a run directory and a typed placeholder spec;
- detects the Flow360 CLI and records its version;
- dry-runs the intended operations without contacting Flow360.

### M1 — deterministic external-aero preset

- support a simple wing first;
- compile the preset to valid SimulationParams;
- validate units, operating conditions, boundaries, and force outputs;
- show a readable plan and semantic diff.

### M2 — approved execution

- create/reuse Flow360 projects and drafts;
- submit only after an explicit approval gate;
- persist resource IDs and recover status after process restart;
- stream state and logs.

### M3 — result understanding

- retrieve requested result artifacts;
- assess residual/force convergence;
- report Cd/Cl and limitations with evidence;
- compare two runs.

### M4 — conversational iteration

- translate “increase AoA to 5°” into a small reviewed merge patch;
- create parameter sweeps with budget warnings;
- compare variants against the original decision goal.

## First end-to-end acceptance test

Given a known wing geometry, a reference chord, air at a specified condition,
and the goal “estimate lift and drag at 0° and 5°”:

1. Vibe Flow360 creates a complete, inspectable plan.
2. It refuses to run until units and reference area are confirmed.
3. After approval, it creates the Flow360 resources and records their IDs.
4. It survives restart and resumes monitoring.
5. It reports convergence separately from the requested coefficients.
6. It explains the parameter differences between the two cases.

## Ideas after the MVP

- visual boundary-condition assignment;
- geometry-aware surface naming suggestions;
- screenshot/contour result narration;
- reusable organization presets and review policies;
- cost/time estimates learned from prior runs;
- optimization loops and design-of-experiments;
- shareable reports with reproducible run links;
- domain packs for automotive, aircraft, turbomachinery, and thermal analysis.

## Naming

Product name: **Vibe Flow360**.

Alternatives:

- FlowPilot
- SimPrompt
- AeroVibe
- FlowMate
- SimCopilot

“Vibe Flow360” keeps the interaction model explicit while tying the product
unambiguously to its Flow360 execution backend. The technical subtitle remains:
**Conversational, auditable CFD with Flow360**.
