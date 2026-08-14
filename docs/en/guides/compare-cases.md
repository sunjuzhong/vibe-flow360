# Compare Cases

Open **Compare** from a Project that contains Cases, or open a saved comparison
from `/compares`.

## Build a comparison

Select two or more Cases and identify the baseline and candidates. The
comparison workspace keeps participant order and availability, so a saved
comparison can still explain when a Case was deleted or is inaccessible.

The workspace can compare:

- Simulation parameter differences
- Available convergence and KPI summaries
- Matched result artifacts
- Compatible tabular result columns and numeric deltas
- Available visualization selections

Not every Case exposes every category. Missing results remain missing rather
than being replaced with synthetic values.

## Ask AI

The comparison analysis sends the selected Case summaries, differences, and
the user's question to the configured agent. The response and provider details
are stored as a revision in the saved comparison workspace.

AI can identify coupled changes and suggest a cleaner comparison, but it cannot
prove causality when geometry, operating condition, model, mesh, or review
window changed together.

## Parameter sweeps

The comparison page can prepare a sweep request from a baseline Case and a set
of parameter values. Review the generated Cases and the potential remote work
before submission; a sweep multiplies compute consumption.
