# T12 expected report

Report Water density and viscosity, current speed, pile diameter and height, Reynolds number, dynamic pressure, and hydrostatic pressure span. Confirm the semantic diff contains only the `Fluid.gravity` addition.

For computed results, plot pressure versus elevation away from the pile and on its upstream and downstream surfaces. Fit the farfield slope and compare it with `-rho g = -9810 Pa/m`. Remove that depth trend before attributing remaining pressure differences to the current. Report drag and vertical force separately, with residual and mesh checks.

Do not interpret raw pressure or Cp as current-only loading in the gravity case, and do not extend this single-phase setup to free-surface or cavitating physics.
