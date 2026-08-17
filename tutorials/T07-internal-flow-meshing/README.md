# T07 — Mesh a closed internal duct

T07 teaches how to recognize a CAD-defined internal fluid volume, select the
correct Flow360 domain path, place a seed point in the connected passage, and
add mesh resolution where blockage and wall shear generate pressure loss.

The package includes the official Flow360 internal-flow CSM geometry. Users do
not upload their own CAD or mesh. The Web tutorial creates one Geometry Project
and two configured VolumeMesh Drafts:

1. a global-only baseline;
2. a feature-aware variant for the sphere, supports, floor layer, and spacing
   transitions.

Neither Draft is submitted automatically.

## Reproduce and validate

```bash
python3 tutorials/T07-internal-flow-meshing/build_simulation.py --check
make tutorials-validate
```

Review [expected/report.md](expected/report.md) and
[expected/evidence.yaml](expected/evidence.yaml) before running a mesh.
