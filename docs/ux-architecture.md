# VibeSim Web information architecture

## Product center

VibeSim is project-first.

The home page finds or creates a project. The project page is where simulation
work begins. AI is available everywhere, but its context becomes precise only
after the user enters a project and selects a resource.

The primary object hierarchy is:

```text
Workspace
  └── Folder
        └── Project
              └── Resource tree
                    ├── Geometry
                    ├── SurfaceMesh
                    ├── VolumeMesh
                    └── Case
```

A Project resource tree is not necessarily a four-step linear pipeline:

- a project may start from Geometry, SurfaceMesh, or VolumeMesh;
- one Geometry may produce several SurfaceMeshes;
- one SurfaceMesh may produce several VolumeMeshes;
- one VolumeMesh may produce many Cases;
- a Case may derive another Case through restart, interpolation, or variation.

The UI must represent branching and partial workflows without inventing missing
stages.

## Route model

```text
/                                      Workspace home
/projects/new                          Create/import project
/projects/:projectId                   Project workbench
/projects/:projectId/resources/:id     Selected resource, deep-linkable
/projects/:projectId/compare           Compare cases or branches
```

Resource type can stay in API data rather than the URL. The resource ID prefix
already identifies Geometry, SurfaceMesh, VolumeMesh, and Case.

## 1. Workspace home

The home page has one job: get the user into a project.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ VibeSim     Search projects             Flow360 · prod · connected   │
├───────────────┬──────────────────────────────────────────────────────┤
│ FOLDERS       │ Projects in “examples”              + New project   │
│               │                                                      │
│ ▸ My work     │ [Search] [Type] [Status] [Sort]                     │
│ ▾ examples    │                                                      │
│   automotive  │ DrivAer Sedan     Geometry   2 SM · 2 VM · 4 Cases  │
│   tutorials   │ Tutorial 30p30n   Geometry   1 SM · 1 VM · 1 Case   │
│               │ ...                                                  │
│               │                                                      │
│               │                              Ask AI about projects ↗ │
└───────────────┴──────────────────────────────────────────────────────┘
```

### Home interactions

- Folder chevron expands/collapses without changing selection.
- Folder name selects the folder and loads its direct projects.
- Project row/card opens `/projects/:projectId`.
- Search filters projects in the selected folder.
- “New project” opens the import/create flow.
- Global AI can locate projects, explain statuses, and start a new-project plan.
- Recent runs appear only after real run-history data exists.

### Remove from the current prototype

- decorative project cards with fake data;
- buttons without a defined action;
- fixed pipeline preview before a project exists;
- permanent AI panel consuming workspace width when there is no conversation.

If an action is not implemented, hide it. Use a disabled button only when the
action exists but a prerequisite is currently missing, and explain that
prerequisite in a tooltip.

## 2. Project workbench

The project page uses three coordinated surfaces:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ examples / DrivAer Sedan     release-25.9     Refresh   •••   Ask AI      │
├──────────────────┬─────────────────────────────────────┬───────────────────┤
│ RESOURCE TREE    │ MAIN WORKSPACE                      │ INSPECTOR / AI    │
│                  │                                     │                   │
│ ◉ Geometry       │ Selected resource title + state     │ Overview          │
│ ├─ SurfaceMesh A │                                     │ Parameters        │
│ │  └─ Volume A   │  3D viewer / convergence / results  │ Validation        │
│ │     ├─ Case 1  │  depending on resource type         │ Activity          │
│ │     └─ Case 2  │                                     │                   │
│ └─ SurfaceMesh B │  Primary action for next valid step │ Chat with AI      │
│    └─ Volume B   │                                     │                   │
│       └─ Case 3  │                                     │                   │
└──────────────────┴─────────────────────────────────────┴───────────────────┘
```

### Header

- breadcrumb back to folder and workspace;
- editable project name;
- solver version and tags;
- aggregate status/counts;
- refresh;
- overflow actions such as open in Flow360, rename, or delete;
- no global “Run” button because execution always belongs to a specific branch.

### Resource tree

Each node displays:

- type icon and name;
- lifecycle state;
- error/running indicator;
- child count when collapsed;
- context menu;
- creation action where physically valid.

The tree supports:

- branching;
- deep links and browser history;
- expand/collapse;
- text filtering;
- type and state filtering;
- compact mode for projects with tens or hundreds of Cases;
- “group Cases by parent” and flat Case list views.

For very large projects, load `project tree` for structure and use
`project items` for search/filtering. Do not render hundreds of expanded nodes
by default.

## 3. Resource-specific workspace

Selecting a node changes the center canvas, inspector, available actions, and AI
context.

### Geometry

Center:

- 3D geometry viewer;
- face/group selection;
- geometry scale and bounding box;
- validation issues.

Inspector:

- metadata and lifecycle state;
- user-intent/SimulationParams summary;
- units;
- tags;
- surface/edge group inventory.

Primary action:

- create SurfaceMesh plan;
- if the project is already rooted at a later stage, Geometry is absent rather
  than displayed as incomplete.

### SurfaceMesh

Center:

- surface mesh viewer;
- boundary/zone coloring;
- mesh-quality summary;
- validation warnings.

Inspector:

- mesh parameters;
- source Geometry;
- lifecycle state and logs;
- child VolumeMeshes.

Primary action:

- create VolumeMesh plan;
- create a variant by patching mesh parameters.

### VolumeMesh

Center:

- volume-domain preview or slices;
- cell counts and quality metrics;
- region/boundary inventory.

Inspector:

- meshing parameters;
- source SurfaceMesh when present;
- lifecycle state and logs;
- child Cases.

Primary action:

- create Case plan;
- launch a parameter sweep as several reviewed Case variants.

### Case

Center tabs:

- Overview;
- Convergence;
- Forces/monitors;
- Contours and slices;
- Result artifacts;
- Logs.

Inspector:

- lifecycle state;
- operating conditions;
- solver settings;
- requested outputs;
- parent resource and derived Cases;
- runtime/cost metadata when available.

Primary actions:

- compare;
- create variation;
- restart/interpolate;
- download result;
- open in Flow360.

Case status and result trust are separate. “Completed” does not automatically
mean “converged” or “credible”.

## 4. AI interaction model

AI is a contextual copilot, not a separate destination.

### Context levels

| Location | AI context |
| --- | --- |
| Workspace | folders, project search, create-project intent |
| Project | metadata, full resource tree, aggregate states |
| Geometry | geometry summary, units, groups, validation |
| SurfaceMesh | mesh parameters, boundaries, quality |
| VolumeMesh | domain, cell metrics, available Case parents |
| Case | conditions, solver settings, convergence, results |

### AI action protocol

```text
User intent
  → AI proposes a structured action
  → deterministic validation
  → semantic parameter diff
  → cost/scope warning
  → explicit user approval
  → Flow360 CLI execution
  → resource tree refresh
```

Chat messages can contain interactive artifacts:

- missing-input checklist;
- proposed SimulationSpec;
- parameter diff;
- branch preview;
- validation errors;
- execution approval card;
- live run status;
- result comparison.

The chat itself never claims that a remote mutation happened without a returned
Flow360 resource ID.

## 5. Interaction state rules

Every control must be in one of four explicit states:

1. **Available** — action can run now.
2. **Disabled with reason** — valid action, missing a prerequisite.
3. **Loading** — action is in progress and cannot be repeated.
4. **Hidden** — action is irrelevant or not implemented.

Never use loading copy for empty or error states.

Every remote mutation needs:

- pending state;
- success response with resource ID;
- recoverable error;
- idempotency or double-submit protection;
- a resource-tree refresh after success.

## 6. Backend read model

Already available:

```text
GET /api/flow360/status
GET /api/flow360/folders
GET /api/flow360/projects?folder_id=...
GET /api/flow360/projects/:projectId
GET /api/flow360/projects/:projectId/tree
GET /api/flow360/projects/:projectId/items
```

Implemented resource-detail endpoints:

```text
GET /api/flow360/resources/:type/:id
GET /api/flow360/resources/:type/:id/logs
```

The aggregate resource endpoint reads info, state, summary, SimulationParams,
and Case result artifacts in parallel. Individual unavailable fields are
reported as partial errors, so one failed CLI subcommand does not erase the
rest of the resource.

## 7. Mutation model

Do not expose a generic “run CLI command” API.

Use typed endpoints:

```text
POST /api/projects/plan
POST /api/projects
POST /api/projects/:id/branches/plan
POST /api/plans/:id/approve
POST /api/plans/:id/run
POST /api/cases/:id/variations/plan
```

A locally persisted plan contains:

- user intent;
- selected project and parent resource;
- assumptions and provenance;
- normalized SimulationSpec;
- compiled Flow360 parameters;
- semantic diff;
- proposed commands;
- solver version;
- expected created resource type;
- status and returned remote IDs.

## Delivery sequence

### P0 — honest navigation

- make every visible home action functional or remove it;
- separate folder expansion from selection;
- open a real Project route from each project row;
- add empty, error, loading, and retry states;
- make URL and browser history authoritative.

### P1 — read-only Project workbench

- project header and metadata;
- real branching resource tree;
- resource selection/deep links;
- generic metadata/state inspector;
- type-aware empty canvas;
- refresh and open-in-Flow360.

This is the next implementation milestone.

### P2 — resource detail

- Geometry, SurfaceMesh, VolumeMesh, and Case-specific inspectors;
- SimulationParams summaries;
- logs and Case result artifacts;
- convergence/result views;
- support large Case collections.

### P3 — contextual AI

- send selected Project/resource context to chat;
- structured planning cards;
- missing-input resolution;
- parameter diff and deterministic validation.

### P4 — approved execution

- create project from uploaded Geometry/SurfaceMesh/VolumeMesh;
- create draft and set/patch SimulationParams;
- approval gate;
- execute to SurfaceMesh, VolumeMesh, or Case;
- wait, logs, recovery after restart, and tree refresh.

Implemented in the Project workbench:

- durable local branch plans stored under `VIBESIM_DATA_DIR`;
- source/target compatibility checks and guarded JSON merge patches;
- semantic SimulationParams diff and credential-free CLI preview;
- immutable draft → approved → submitting → submitted/failed state machine;
- separate review checkbox and billable-work confirmation;
- atomic writes, double-submit prevention, and interrupted-submission recovery;
- Project tree refresh after Flow360 accepts a run.

Project creation from uploaded files remains a separate import surface because
it requires durable upload storage in addition to plan metadata.

### P5 — iteration and comparison

- Case variations and sweeps;
- compare branches and KPIs;
- convergence assessment;
- decision-oriented AI reports.

## P1 acceptance criteria

1. A user can select a folder, select a project, and arrive at a stable URL.
2. Refreshing the URL restores the same project and selected resource.
3. The resource tree exactly reflects Flow360 parent/child relationships.
4. Geometry-, SurfaceMesh-, VolumeMesh-, and Case-rooted projects all render.
5. Selecting any resource displays its real ID, type, name, and available state.
6. Projects with more than 100 Cases remain usable without expanding everything.
7. No visible button is a no-op.
8. Remote data failures have retry actions and never masquerade as loading.
