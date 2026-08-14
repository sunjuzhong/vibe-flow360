# Local and cloud architecture

Vibe Flow360 separates the local interaction layer from remote computation.

```text
Browser
  ↓ HTTP / SSE
Local Go server
  ├── embedded React application
  ├── AI service and scoped sessions
  ├── plans, approvals, and recovery state
  ├── Project mirror and visualization cache
  └── Flow360 CLI adapter
          ↓
      Flow360 Cloud
```

## What stays local

- The Web application and HTTP server
- AI conversation and plan state
- Imported STEP library metadata and files
- Mirrored Project metadata
- Visualization assets that have been opened
- Small Case histories downloaded for convergence review

The storage root defaults to `.vibesim` and can be changed with
`VIBESIM_DATA_DIR`.

## What remains remote

- The authoritative Flow360 Folder, Project, Draft, mesh, and Case resources
- Surface meshing, volume meshing, and solver execution
- Cloud status and result artifacts that have not been downloaded

Initial Project synchronization is metadata-only. Large CAD, mesh, volume, and
Case result archives are not copied automatically.

## Trust boundary

The React application calls the local server; it does not receive the Flow360
API key. The server invokes the configured Flow360 CLI. External Codex agent
runs are ephemeral and read-only, and Flow360 and AI credentials are removed
from their environment.
