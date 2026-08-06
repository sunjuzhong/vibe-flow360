# T02 execution plan

The Geometry root retains surface and volume meshing. A SurfaceMesh root skips CAD and surface meshing but still requires volume meshing before a Case. A VolumeMesh root skips all meshing stages and validates only Case physics and outputs.

The Web lesson lets the learner upload either supported mesh root. It creates the remote Project, then two local Case Plans at α=0° and α=5°. No mesh or solver execution is submitted. Because boundary names belong to the uploaded mesh, both Plans remain explicitly reviewable and must be mapped to physical boundary models before approval.
