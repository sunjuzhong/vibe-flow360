# Current limitations

Vibe Flow360 is an active prototype. Its local workspace is functional, but it
does not expose every Flow360 Python or hosted-interface capability.

- Flow360 Cloud remains required for authoritative resource state, meshing,
  solver execution, and result retrieval.
- Offline access is limited to material already stored in the local mirror.
- Initial synchronization intentionally excludes large CAD, mesh, volume, and
  Case result archives.
- Available 3D fields, result views, convergence summaries, and playback depend
  on the artifacts returned for each resource.
- AI Create supports a constrained declarative CAD operation graph. It is not a
  general-purpose CAD system and does not execute model-generated Python.
- Without a configured model provider, AI Create is unavailable and the
  built-in assistant falls back to deterministic supported planning behavior.
- AI interpretations do not establish convergence, validation, or causality.
- The current guided Web library contains T01 through T06. Other tutorial IDs in
  the coverage plan are future work.
- The codebase is customizable, but it does not currently provide a packaged
  third-party plugin system.
- No published benchmark currently quantifies bandwidth savings or performance
  relative to the hosted Flow360 interface.

Use Flow360's supported engineering practices and independent review for
production decisions. Inspect the exact parameters and cloud resources before
approving remote work.
