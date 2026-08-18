# T17 — Initialization and restart

This tutorial uses a finite-span vane to decide how a 12° target case should be initialized after an 8° source case. It separates three operations that are often confused:

1. a new Case initialized from the target freestream;
2. a new Case initialized by explicit spatial expressions;
3. a fork initialized from a real parent Case, optionally modified or interpolated to another mesh.

The Web lesson creates three runnable Drafts: the 8° source, the 12° uniform target, and the 12° expression-seeded target. It does not create a restart Draft before a parent Case exists. After the source finishes, the supplied modified-restart patch can be applied while forking from that Case.

Rebuild and validate the artifacts with:

```bash
python3 tutorials/T17-initialization-restart/build_simulation.py --check
```
