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
- browser-native guided tutorials at `/tutorials`, beginning with the T01
  lift-and-drag lesson built from its pinned SimulationParams artifact;
- homepage **AI Create** flow that turns a cylinder-flow requirement into a
  CAD-kernel-generated, validated analytic B-rep Geometry, a Flow360 Project,
  and a preloaded Case plan;
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

Build once, then let the application prepare its own isolated runtime:

```bash
make build
./vibe-flow360 init
```

`init` is safe to rerun. It bootstraps a pinned `uv`, Python 3.11, Flow360
`25.10.*`, and CadQuery 2.6.1 under the user configuration directory; merges
the required absolute paths and defaults into a mode-0600 `.env`; preserves
unmanaged values and comments; verifies the Flow360 CLI; and performs a
read-only authenticated project request. If no credential is available, an
interactive run opens Flow360's official browser login. For headless setup,
provide `FLOW360_APIKEY` in the process environment and use `--no-login`.
CI and image-build validation may use `--skip-auth-check`; this still installs
and verifies every local runtime, but it is not a substitute for authenticated
initialization before normal use.

Useful setup overrides include:

```bash
./vibe-flow360 init --flow360-version '25.10.*' --profile default --environment uat
./vibe-flow360 init --tools-dir /absolute/runtime/path --env-file /absolute/path/.env
```

Start the backend:

```bash
./vibe-flow360 serve
# Source-tree equivalent:
go run -buildvcs=false ./cmd/server serve
```

Start the frontend in a second terminal:

```bash
cd web
npm install
npm run dev
```

The Vite server prints the browser URL and proxies `/api` to
`http://localhost:9292`.

## Init cold-start CI

`.github/workflows/init-smoke.yml` repeats a credential-free first installation
every day and on relevant pull requests or pushes, using clean Ubuntu and macOS
runners. It verifies the generated dotenv, Flow360 executable, offline reuse of
the pinned Python/CadQuery runtime, and the running server health endpoint.

Add a repository Actions secret named `FLOW360_APIKEY` to enable the additional
read-only live account gate on scheduled, manual, and main-branch runs. The
workflow deliberately withholds this secret from every pull-request run,
including branches created by repository collaborators.

### Manual releases

Run the `Release` workflow from the GitHub Actions page to build Linux and
macOS archives for amd64 and arm64. The workflow resolves the exact package
version selected by the current `vibe-flow360 init` defaults and uses that same
version for the binary, archive names, Git tag, and GitHub Release. Its
`publish` input defaults to true; set it to false to build and validate all
artifacts without creating a tag or Release.

Release binaries report the matching version directly:

```bash
vibe-flow360 version
```

Open `/tutorials` from the top navigation to enter the tutorial library. T01
teaches the engineering question, geometry semantics, parameter provenance,
the controlled 0°/5° variant, and the evidence contract entirely in the Web UI.
Its final step can create a processed Flow360 Geometry and two preconfigured,
locally reviewable Case Plans after an explicit Project-creation confirmation;
mesh and Case execution remain separately locked behind the normal approval gate.

## Agent configuration
## Agent configuration

The default `builtin` provider preserves the current behavior. Without an API
key, it uses the deterministic local CFD planner:

```bash
export VIBESIM_AGENT_PROVIDER="builtin"
export VIBESIM_AI_API_KEY="..."
export VIBESIM_AI_BASE_URL="https://api.openai.com/v1"
export VIBESIM_AI_MODEL="gpt-4.1-mini"
```

If the provider is unavailable or out of quota, chat falls back to the local
planner instead of breaking the workflow.

To use the locally installed Codex CLI as the external agent:

```bash
export VIBESIM_AGENT_PROVIDER="codex"
export VIBESIM_CODEX_BINARY="codex"        # or an absolute path
export VIBESIM_CODEX_MODEL=""              # empty uses the Codex CLI default
export VIBESIM_CODEX_PROFILE=""            # optional Codex config profile
export VIBESIM_CODEX_TIMEOUT_SECONDS="300"  # per-request budget for complex Flow360 schemas
```

External Codex runs with `codex exec --ephemeral --sandbox read-only`. Vibe
Flow360 passes CFD context in the prompt, captures only the final response, and
does not forward Flow360 credentials. The external agent cannot approve or
submit a Flow360 run; the existing reviewed Plan workflow remains authoritative.

AI Create requires a configured model provider. The model produces a validated,
declarative CAD operation graph rather than arbitrary Python; the local
CadQuery/OpenCascade runtime executes that graph, exports exact STEP, and checks
that it round-trips as one valid closed solid before anything is sent to
Flow360. `vibe-flow360 init` preloads the pinned CadQuery runtime. Optional
runtime settings are `VIBESIM_UV_BINARY`, `VIBESIM_UV_CACHE_DIR`,
`VIBESIM_UV_PYTHON_INSTALL_DIR`, `VIBESIM_CAD_PYTHON`,
`VIBESIM_CAD_TIMEOUT_SECONDS`, and `VIBESIM_CAD_OFFLINE=true`.

## Flow360 configuration

The Go backend loads `.env` at startup without overriding variables already set
by the shell. Normally `vibe-flow360 init` creates this file. To configure it
manually instead, copy the example and choose one authentication mode:

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

Opening a Project shows a recent local inventory immediately, then refreshes
resource metadata progressively in the background. Completed mirrors remain
fresh for five minutes unless the user requests a complete refresh. Set
`VIBESIM_DATA_DIR` to an absolute path when
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
  resources/<Geometry|SurfaceMesh|VolumeMesh|Case>/<resource-id>/visualize/manifest/
    manifest.json
    <buffer>.bin
```

Each resource detail contains `info`, `state`, `summary`, raw
`simulation_params`, and—for Cases—the result artifact list. Geometry UVF
tessellation manifests and their referenced `.bin` buffers are downloaded
atomically when a 3D preview is first opened, then reused from the mirror. The
initial `metadata-only` synchronization deliberately excludes large CAD, mesh,
surface, volume, and Case result archives. Small result histories used by
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
./vibe-flow360 init
./vibe-flow360 serve
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
