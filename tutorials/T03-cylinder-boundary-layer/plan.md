# T03 execution plan

## Local verification

```bash
python3 tutorials/T03-cylinder-boundary-layer/build_simulation.py --check
make tutorials-validate
```

## Web workflow

1. Open `/tutorials/T03` and review the geometry scale.
2. Compare the baseline and refined mesh assumptions.
3. Complete the mesh evidence contract.
4. In the final step, select the destination folder and explicitly authorize Project creation.
5. The app creates the Geometry Project and two configured Flow360 VolumeMesh Drafts.
6. Review a Draft in the Project before starting paid cloud meshing.

No surface or volume mesh is submitted automatically by the tutorial.
