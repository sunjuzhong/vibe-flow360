# Vibe Flow360

[English](README.md) | [简体中文](README.zh-CN.md)

**Describe the physics. Review the plan. Run with confidence.**

Vibe Flow360 is a locally hosted, AI-native workspace for
[Flow360](https://www.flexcompute.com/flow360/). It connects to your existing
Flow360 account through the CLI, brings cloud projects into a responsive Web
workspace, and helps you plan, review, run, and understand CFD simulations
without turning every engineering question into a Python project.

```text
You: Compare these two Cases and explain why drag increased.

Vibe Flow360:
  I loaded their parameters, convergence histories, and available results.
  The candidate changed angle of attack and mesh refinement together.
  I can separate those changes, but the current comparison does not isolate
  a single cause.
```

## Why Vibe Flow360

Flow360 already provides a Python API and a hosted Web interface. Vibe Flow360
adds a different way to work:

- **Local by design.** The Go server and React workspace run on your machine.
  Project metadata and opened visualization assets are mirrored locally and
  refreshed from Flow360 Cloud.
- **Built on Flow360.** Authentication, validation, Drafts, and remote execution
  continue to use the installed `flow360` CLI and your existing cloud account.
- **Made to be adapted.** Teams can extend the local server and Web workspace
  with their own review rules, workflows, visualizations, and integrations.
- **AI with engineering guardrails.** The assistant can clarify intent, prepare
  plans, propose parameter changes, diagnose failures, and interpret results.
  It cannot approve or submit billable work for you.

Vibe Flow360 is not a replacement solver or a second cloud platform. Flow360
performs the remote computation; Vibe Flow360 provides a customizable local
engineering layer around it.

## What you can do today

- Browse Flow360 folders, Projects, and Geometry, SurfaceMesh, VolumeMesh, and
  Case resources.
- Import CAD, manage a versioned STEP library, or generate supported analytic
  STEP geometry with AI Create.
- Inspect resources in dedicated 3D workspaces and keep lightweight Project
  metadata and opened visualization assets in a local mirror.
- Ask AI in Project, Resource, or Draft context and keep the conversation tied
  to the engineering object under review.
- Create and edit Draft parameters with schema-driven forms or JSON, validate
  them locally, and review semantic differences before execution.
- Approve an immutable plan, submit it through the Flow360 CLI, monitor its
  state, and recover interrupted or failed workflows.
- Inspect Case results, convergence information, and result tables; compare
  Cases in a saved comparison workspace and request an AI interpretation.
- Learn in the browser with six guided, locally checkable CFD tutorials.

## Try it locally

Requirements: Go 1.24+, Node.js 22+, and a Flow360 account.

```bash
make build
./vibe-flow360 init
make serve
```

Open [http://localhost:9292](http://localhost:9292). `init` prepares an isolated
Python 3.11 runtime, installs the pinned Flow360 and CadQuery dependencies,
creates or updates `.env`, and verifies authentication. It is safe to run again.
`make serve` rebuilds the Web app and Go server, stops an existing Vibe Flow360
instance on the same address, and starts the fresh workspace binary in the
foreground. Override the defaults with `SERVE_ADDR=127.0.0.1:9393` or
`SERVE_ENV_FILE=/absolute/path/to/.env`.

For source development, run the backend and Vite frontend separately:

```bash
go run -buildvcs=false ./cmd/server serve
cd web
npm install
npm run dev
```

The frontend proxies `/api` to the local server at `http://localhost:9292`.

## Learn the workflow

Start with the [product overview](docs/en/overview/why-vibe-flow360.md), follow
the [first simulation workflow](docs/en/getting-started/first-simulation.md), or
open `/tutorials` in the running application.

The current tutorial library covers:

1. Trustworthy lift and drag
2. Mach and Reynolds similarity
3. Curvature-sensitive cylinder meshing
4. Multi-element airfoil edge refinement
5. Flow-aligned wake refinement
6. External farfield selection

Every tutorial can be explored without submitting cloud work. Creating or
running Flow360 resources remains behind an explicit confirmation or approval.

## Local workspace, cloud computation

```text
Browser
  ↓
Vibe Flow360 on your machine
  ├── Web workspace and AI sessions
  ├── Project mirror and visualization cache
  ├── parameter validation and approval state
  └── Flow360 CLI adapter
          ↓
      Flow360 Cloud
```

Initial Project synchronization is metadata-only. Geometry visualization data
is downloaded when opened and then reused locally; large CAD, mesh, volume, and
Case result archives are not copied during the initial sync. Live refresh,
remote execution, and result downloads still require Flow360 Cloud and a
working network connection.

## Safety boundary

AI output is a proposal, not an approval. Remote execution becomes available
only after the plan passes Flow360-schema preflight, the user reviews the exact
parameter changes, approves the immutable plan, and confirms submission.
Credentials remain in the local server process and are not returned to the Web
application.

Vibe Flow360 is an active prototype. Read the current
[limitations](docs/en/reference/limitations.md) before using it for production
engineering decisions.

## Documentation

- [Overview](docs/en/index.md)
- [Installation](docs/en/getting-started/installation.md)
- [Projects and resources](docs/en/guides/projects-and-resources.md)
- [AI planning and review](docs/en/guides/ai-plan-and-review.md)
- [Run monitoring and results](docs/en/guides/run-and-results.md)
- [Case comparison](docs/en/guides/compare-cases.md)
- [Configuration](docs/en/reference/configuration.md)
- [Troubleshooting](docs/en/reference/troubleshooting.md)
- [Ten-minute team demo](docs/en/team/demo-script.md)
