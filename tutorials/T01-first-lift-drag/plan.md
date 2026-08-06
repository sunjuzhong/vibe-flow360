# T01 execution plan

## Local, no-cloud validation

From the repository root:

```bash
python3 tutorials/T01-first-lift-drag/build_simulation.py --check
python3 scripts/validate_tutorials.py
go run ./cmd/tutorial-coverage --validation-report .tutorial-validation/report.json
```

These commands validate the baseline and the 5° merge patch against the pinned
Flow360 package. They do not submit work or require credentials.

## Optional cloud run

Cloud submission consumes Flow360 resources. Review `spec.yaml`, the estimated
mesh fidelity, and your target environment before running these commands.

```bash
cd tutorials/T01-first-lift-drag

flow360 project create \
  --from geometry \
  --name "Tutorial T01 first lift and drag" \
  --solver-version release-25.10 \
  --unit m \
  --sync \
  assets/geometry.csm
```

Copy the Geometry ID from the command output and use it as `<GEOMETRY_ID>`:

```bash
flow360 draft run <GEOMETRY_ID> simulation.json \
  --name "T01 baseline alpha 0" \
  --up-to case \
  --wait

flow360 draft run <GEOMETRY_ID> simulation.json \
  --patch variants/alpha-5deg.patch.json \
  --name "T01 variant alpha 5" \
  --up-to case \
  --wait
```

For each returned Case ID:

```bash
flow360 case summary <CASE_ID>
flow360 case results list <CASE_ID>
```

Download the residual, force, and surface artifacts reported by the list command
with `flow360 case results get`. Do not treat successful completion alone as a
trustworthy result; evaluate every required criterion in the evidence contract.
