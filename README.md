# Vibe Flow360

Vibe Flow360 is a conversational CFD copilot for [Flow360](https://www.flexcompute.com/flow360/).
It turns an engineering goal into an inspectable simulation plan, asks only for
missing information, and then drives the existing `flow360` CLI through geometry,
meshing, case execution, and result review.

> Product thesis: describe the physics first; edit parameters second.

## The experience

```text
You: Simulate this car at 30 m/s. I care about drag and front/rear lift balance.

Vibe Flow360:
  I found car.step and inferred a steady, external-aerodynamics study.
  Before I build the run:
  1. Is the car length 4.62 m?
  2. Should the ground move at 30 m/s?
  3. Are the four wheel surfaces rotating?

You: Yes. Use standard air at sea level and start with a medium mesh.

Vibe Flow360:
  Plan ready:
  - incompressible, steady RANS
  - velocity: 30 m/s
  - moving ground and rotating wheels
  - outputs: Cd, Cl, axle lift balance, surface pressure
  - estimated stage: geometry → surface mesh → volume mesh → case

  I will show the exact parameter diff before submitting billable work.
```

The assistant does not hide CFD. Every inference is labeled, every generated
configuration is saved, and every remote action can be reproduced with a CLI
command.

## Current prototype

The repository now contains a working local Web prototype:

- React/Vite simulation workspace with a persistent **Chat with AI** panel;
- Go HTTP backend modeled after Tongstock's server architecture;
- SSE streaming chat responses;
- OpenAI-compatible model support with a resilient local CFD planning fallback;
- local Flow360 CLI detection and read-only project listing;
- read-only Flow360 folder-tree access;
- branching Project workbench with resource state, parameters, results, and logs;
- durable local execution plans with semantic SimulationParams diffs;
- local Flow360-schema preflight with recursive, schema-generated forms for
  missing SimulationParams values;
- deterministic validation and a separate explicit approval gate;
- approved `flow360 draft run` submission with persisted recovery state.

Chat cannot submit billable work. Remote execution is available only from a
compiled plan after Flow360 schema preflight succeeds, the user reviews the
exact diff, approves that immutable plan, and confirms submission again.

The Web loads the online folder tree first, then requests projects for the
selected folder. Folder-scoped listing also avoids a current Flow360 CLI issue
where unsupported `Report` root items can break an unfiltered workspace-wide
project list.

## Run locally

Requirements:

- Go 1.24+
- Node.js 22+
- an installed and authenticated `flow360` CLI

Start the backend:

```bash
go run -buildvcs=false ./cmd/server
```

Start the frontend in a second terminal:

```bash
cd web
npm install
npm run dev
```

The Vite server prints the browser URL and proxies `/api` to
`http://localhost:9292`.

## AI configuration

Without configuration, chat uses the deterministic local CFD planner. To connect
an OpenAI-compatible model, set:

```bash
export VIBESIM_AI_API_KEY="..."
export VIBESIM_AI_BASE_URL="https://api.openai.com/v1"
export VIBESIM_AI_MODEL="gpt-4.1-mini"
```

If the provider is unavailable or out of quota, chat falls back to the local
planner instead of breaking the workflow.

## Flow360 configuration

The Go backend loads `.env` at startup without overriding variables already set
by the shell. Copy the example and choose one authentication mode:

```bash
cp .env.example .env
```

Use a key directly:

```dotenv
FLOW360_APIKEY=your-key
VIBESIM_FLOW360_PROFILE=default
VIBESIM_FLOW360_ENV=uat
# Optional: bypass shell/pyenv shims in background services.
VIBESIM_FLOW360_BINARY=/absolute/path/to/flow360
```

Or keep the key in Flow360's own local configuration:

```bash
flow360 login --profile default --uat
```

```dotenv
FLOW360_APIKEY=
VIBESIM_FLOW360_PROFILE=default
VIBESIM_FLOW360_ENV=uat
```

`VIBESIM_FLOW360_ENV` accepts an empty value for production, `dev`, `uat`, or a
named environment. Vibe Flow360 converts these settings to global CLI options before
every subcommand, for example:

```text
flow360 --profile default --uat project list --format json
```

`VIBESIM_FLOW360_BINARY` is optional. When it is unset and `flow360` resolves
to a pyenv shim, Vibe Flow360 looks for the real executable in pyenv's named
`flow360` virtual environment. This keeps background services independent of
their working directory and the global pyenv version.

The API key remains server-side. It is never returned by the status API or sent
to the React application.

### Compatibility identifiers

The product and executable are named **Vibe Flow360** and `vibe-flow360`.
Existing `.vibesim` data directories, `VIBESIM_*` environment variables,
`X-VibeSim-*` response headers, and `vibesim:*` browser events remain supported
as stable compatibility identifiers so an upgrade does not orphan cached
Projects or existing deployments.

## Local Project mirror

Opening a Project starts a bounded full metadata synchronization before the
resource workbench is shown. Set `VIBESIM_DATA_DIR` to an absolute path when
Vibe Flow360 may be started from different working directories:

```dotenv
VIBESIM_DATA_DIR=/absolute/path/to/.vibesim
```

The inspectable mirror is organized by Flow360 environment/profile and Project
ID:

```text
.vibesim/projects/production-default/<project-id>/
  manifest.json
  project.json
  tree.json
  items.json
  resources/<Geometry|SurfaceMesh|VolumeMesh|Case>/<resource-id>/detail.json
  resources/Geometry/<geometry-id>/visualize/manifest/
    manifest.json
    <buffer>.bin
```

Each resource detail contains `info`, `state`, `summary`, raw
`simulation_params`, and—for Cases—the result artifact list. Geometry UVF
tessellation manifests and their referenced `.bin` buffers are synchronized
atomically for Three.js display. The
`metadata+geometry-visualization` policy still deliberately excludes large CAD,
mesh, surface, volume, and Case result archives. Small result histories used by
convergence analysis are downloaded separately under
`.vibesim/cases/<case-id>/`.

## Architecture

```text
React/Vite Web
  ├── simulation workspace
  ├── Flow360 projects
  └── SSE Chat with AI
          ↓
Go/Gin server
  ├── agent service
  ├── durable plan + approval state machine
  └── Flow360 CLI adapter
          ↓
Flow360 project / draft / mesh / case
```

The production build is embedded into the Go binary:

```bash
make build
./vibe-flow360
```

## Core loop

```text
intent
  → inspect local inputs
  → identify missing physics
  → generate SimulationSpec
  → validate and estimate
  → show plan + parameter diff
  → approve
  → invoke Flow360
  → monitor and explain
```

See the [product brief](docs/product-brief.md) and
[Web UX architecture](docs/ux-architecture.md) for the full scope and delivery
sequence.
