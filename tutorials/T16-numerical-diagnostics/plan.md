# T16 execution plan

1. Review geometry, mesh, boundary assignments, and operating condition before attributing a symptom to numerics.
2. Classify the symptom using nonlinear residuals, linear reduction, CFL history, force histories, state bounds, and maximum-residual location.
3. Use the conservative recovery Draft only to obtain a bounded diagnostic trajectory.
4. Restore second-order spatial accuracy and verify that loads and fields stabilize independently of the recovery settings.
5. Evaluate Krylov/SLAU2 as a separate steady efficiency branch, subject to its compatibility rules and line-search evidence.
6. Run only after reviewing the configured Draft and define rollback criteria before spending cloud resources.
