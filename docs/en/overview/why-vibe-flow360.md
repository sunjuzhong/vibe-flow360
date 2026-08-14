# Why Vibe Flow360

Flow360 provides the solver, cloud resources, Python API, CLI, and hosted user
interface. Vibe Flow360 adds a local engineering workspace around those
capabilities.

## A local workspace for cloud simulations

The application runs a Go server on your machine and serves a React interface
in the browser. It reads your Flow360 folders and Projects through the CLI,
keeps a lightweight local Project mirror, and downloads visualization assets
when you open them.

This arrangement gives a team control over the surrounding workflow without
reimplementing Flow360. The local application can evolve with organization
rules, review practices, visualizations, and internal integrations, while the
solver and remote resources remain in Flow360 Cloud.

## AI inside the engineering loop

Ask AI can use Project, Resource, or Draft context. It can clarify an
engineering request, prepare a plan, propose a parameter patch, help diagnose a
failed preflight or execution, and interpret available results.

The assistant does not bypass engineering control. Parameter changes remain
inspectable, preflight uses the installed Flow360 schema, and remote submission
requires explicit approval and confirmation.

## Less repetition, not less engineering

The local mirror makes recent Project metadata available while a live refresh
runs. Opened Geometry visualization assets can be reused from local storage.
This reduces repeated reads for the same material, but remote refreshes, runs,
and result downloads still depend on Flow360 Cloud and the network.

Vibe Flow360 is useful when a team wants a browser workflow that is easier to
adapt than a collection of scripts while remaining more inspectable than an
unreviewed prompt-to-run automation.
