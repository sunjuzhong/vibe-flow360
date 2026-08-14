# Your first simulation workflow

This walkthrough uses an existing Flow360 Geometry and stops before remote
submission unless you explicitly approve it.

## 1. Open a Project

Start Vibe Flow360 and open the workspace. Select a Flow360 Folder, then choose
a Project. The application can show cached metadata first and refresh the
Project from Flow360 in the background.

## 2. Select the starting resource

Open **Resources** and select a Geometry, SurfaceMesh, or VolumeMesh. The
available next stage depends on the selected resource:

- Geometry → SurfaceMesh, VolumeMesh, or Case plan
- SurfaceMesh → VolumeMesh or Case plan
- VolumeMesh → Case plan

Use the resource workspace to inspect the object before planning the run.

## 3. Describe the engineering goal

Open **Ask AI** and state the outcome you need, the operating condition, and the
quantity you care about. Answer any clarification request for information that
the planner cannot safely infer.

## 4. Review the plan

Inspect the proposed stages, assumptions, command preview, and parameter
differences. Required missing values appear in schema-driven controls. You can
also edit complete Draft parameters in Form or JSON mode.

## 5. Run preflight

Preflight validates the current SimulationParams with the installed Flow360
schema. Resolve blocking issues and review warnings before continuing. Ask AI
can propose a repair, but the proposed patch remains visible before it is
applied.

## 6. Approve and submit

Approval locks the reviewed revision. Remote submission still requires a
separate confirmation. This is the point at which a Flow360 cloud operation may
begin and consume paid resources.

## 7. Monitor and inspect

The execution view reports the current phase, resource state, available logs,
and recovery actions. When a Case has results, open its workspace to inspect
convergence, visualizations, and result files.

For a no-cost guided experience, use one of the
[browser tutorials](../tutorials/index.md) instead of submitting the plan.
