# Guided tutorials

Open `/tutorials` in the running application. The six current tutorials combine
CFD reasoning, Flow360 object mapping, a controlled variant, failure diagnosis,
and explicit acceptance checks. Their packaged configurations can be validated
locally without submitting cloud work.

| Tutorial | Engineering question |
|---|---|
| T01 — First trustworthy lift and drag result | What makes a lift/drag comparison at 0° and 5° reviewable? |
| T02 — Match Mach and Reynolds number | How can a wind-tunnel condition preserve compressibility and viscous similarity? |
| T03 — Curvature-sensitive cylinder mesh | How do curvature and boundary-layer controls change a cylinder mesh? |
| T04 — Preserve airfoil edges and gaps | Which edge controls protect leading edges, trailing edges, and narrow passages? |
| T05 — Refine the wake | Where should volume refinement follow separated flow downstream? |
| T06 — Choose the external farfield | When is an automatic farfield sufficient, and when is a CAD-defined domain required? |

Each tutorial asks for confirmation before creating Flow360 Projects or Drafts.
Mesh generation and Case execution remain behind the normal approval boundary.

Validate all tutorial packages from the repository root:

```bash
make tutorials-test
```

The longer tutorial coverage plan describes future lessons. Only T01 through
T06 are currently available in the Web library.
