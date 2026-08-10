# T02 — Match Mach and Reynolds number

This tutorial reuses the bundled T01 aircraft CAD and configures a Mach 0.18, 4° wind-tunnel comparison without requiring a user upload.

The baseline matches Mach at standard ambient density but produces a chord Reynolds number near ten million. The controlled variant uses `AerospaceCondition.from_mach_reynolds` to keep Mach and temperature fixed while deriving the density required for a six-million chord Reynolds number.

```bash
python3 tutorials/T02-wind-tunnel-similarity/build_simulation.py --check
make tutorials-validate
```

The Web lesson creates a Geometry Project from the bundled CAD and synchronizes both configured Case Drafts. It does not submit cloud meshing or solving.
