# Three ways to work with Flow360

Flow360 Python, the hosted Flow360 interface, and Vibe Flow360 serve different
working styles. Vibe Flow360 complements the other two; it does not replace the
Flow360 service or Python API.

| | Flow360 Python | Hosted Flow360 interface | Vibe Flow360 |
|---|---|---|---|
| Primary interaction | Python code and notebooks | Flow360-hosted Web interface | Locally hosted Web workspace |
| Best fit | Programmatic and reusable automation | Standard interactive cloud workflow | Team-specific, AI-assisted workflow |
| Extension model | Write and maintain Python | Features supplied by the hosted product | Modify the local server and frontend |
| Cloud access | Flow360 Python API | Direct hosted access | Installed Flow360 CLI |
| Local state | Files chosen by the script author | Browser and hosted application state | Project mirror, plans, sessions, and selected assets |
| AI workflow | Built by the script author | Depends on hosted product capabilities | Project-, Resource-, and Draft-aware assistant |
| Execution control | Defined by application code | Hosted product controls | Preflight, visible diff, approval, and confirmation |

## Choose Flow360 Python when

You need direct programmatic control, reusable libraries, batch scripts, or
notebook-based engineering work and are comfortable maintaining Python.

## Choose the hosted interface when

You want the standard Flow360 experience without operating a local application
or maintaining a customized workflow.

## Choose Vibe Flow360 when

You want a local browser workspace, an AI-assisted review loop, locally mirrored
resources, or a codebase your team can adapt to its own process.

The three approaches can be used together. A Project created through Python or
the hosted interface can still be opened in Vibe Flow360 after it appears in the
connected Flow360 account.
