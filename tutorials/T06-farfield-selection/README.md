# T06 — Choose the external domain

This tutorial configures the outer computational domain for drag prediction on a one-metre spherical sensor body.

Two CAD contracts are supplied:

- `sphere-body.csm` contains only the solid body and is paired with `AutomatedFarfield`.
- `manual-domain.csm` contains a closed external fluid volume and is paired with `UserDefinedFarfield`.

The automatic path also creates a controlled 20D versus 8D domain-size comparison. The manual domain places its inlet-side boundary 10D upstream, its wake-side boundary 25D downstream, and lateral boundaries 12D from the body. Its projected blockage is approximately 0.136%.

Rebuild and validate locally:

```bash
python3 tutorials/T06-farfield-selection/build_simulation.py --check
make tutorials-validate
```

Use the T06 Web page to review the CFD reasoning, inspect the parameter differences, and create the selected remote Geometry Project with configured VolumeMesh Drafts. Cloud meshing remains a separate action in the Project workspace.
