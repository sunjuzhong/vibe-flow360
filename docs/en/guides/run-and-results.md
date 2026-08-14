# Run monitoring and results

## Submission

An approved plan can invoke `flow360 draft run` for its selected target stage.
The confirmation step is separate from plan approval because the command may
start billable cloud work.

The application persists the plan, approved revision, submitted resource IDs,
and execution phase so the workflow can be inspected after a server restart.

## Monitoring and recovery

The execution monitor refreshes remote state and shows the current phase,
terminal status, and log availability. Execution errors create an intervention
record with context and repair proposals. A selected proposal remains
reviewable before recovery continues.

If the local process loses track of a submitted operation, the recovery action
reconciles persisted state with Flow360 rather than creating an unrelated run.

## Case results

A Case workspace can expose the result artifacts returned by Flow360. Supported
views include convergence summaries, parsed tabular result previews, surface
and volume visualization objects, and available Slice time-series playback.
The exact controls depend on the files and fields present for that Case.

Result tables are parsed locally for column summaries, preview rows, and chart
selection. Ask AI can receive a bounded summary and fingerprint of the selected
result rather than an unrestricted file dump.

Treat an AI interpretation as an aid to review. Check convergence, the selected
time window, reference quantities, mesh adequacy, and relevant field evidence
before accepting an engineering conclusion.
