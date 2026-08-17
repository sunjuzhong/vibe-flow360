# T08 expected engineering review

The 12 m × 5 m analytic tunnel gives a first blockage screen of 2.17/60 =
3.6%. The car-fixed operating condition uses 40 m/s air. The stationary-floor
baseline represents a conventional fixed-road tunnel; it is intentionally not
treated as an on-road condition.

The moving-ground variant keeps geometry, tunnel size, flow speed, mesh
controls, wake box, solver, and outputs fixed. It changes the floor to
`WheelBelts`, prescribes 40 m/s belt velocity, and applies four independent
`WallRotation` models. With a 0.32 m rolling radius, |omega| = 125 rad/s. The
opposite side uses the opposite sign because all wheel axes are expressed as
+y; contact-patch vectors must be inspected before submission.

Acceptance requires unique boundary ownership, valid belt geometry, tyre and
floor-gap mesh quality, recovered outlet flow, converged forces, and field
evidence explaining any drag or lift delta. The tutorial creates Drafts only;
it does not claim a force result before cloud meshes and Cases are run.
