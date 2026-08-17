# T12 — Liquid flow and gravity

T12 uses a four-metre submerged pile in a 2 m/s water current to teach `Water`, `LiquidOperatingCondition`, and the `Gravity` body force. The controlled pair changes only `Fluid.gravity`; geometry, material, speed, mesh, models, and outputs remain fixed.

Run `python3 tutorials/T12-liquid-gravity/build_simulation.py --check` to reproduce both parameter artifacts. The Web tutorial creates one Geometry Project and two configured Case Drafts without submitting mesh or solver compute.
