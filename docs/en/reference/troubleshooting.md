# Troubleshooting

## `init` cannot find or verify Flow360

Run initialization again and inspect the reported binary and profile:

```bash
./vibe-flow360 init --profile default
```

For headless authentication, set `FLOW360_APIKEY` and add `--no-login`. Use
`VIBESIM_FLOW360_BINARY` only when automatic discovery selects the wrong
executable.

## The Web interface reports Flow360 offline

Check that the local server can run the configured CLI with the selected
profile and environment. Restart `vibe-flow360 serve` after changing `.env`.
The status indicator distinguishes a local connection problem from cached
Project data that is still available.

## A Project or resource is stale

Use **Sync** in the Project workbench. A normal open may reuse a recent mirror;
manual synchronization requests a complete metadata refresh. Review any listed
per-resource failures and retry after fixing authentication or network access.

## A 3D preview does not load

Visualization data is fetched separately from metadata. Confirm the resource
is accessible in the selected Flow360 environment, then retry the preview or a
Project synchronization. Large non-visualization archives are not downloaded
by the initial mirror.

## AI Create cannot start

AI Create needs a configured model provider and the local CadQuery runtime.
Check `VIBESIM_AI_API_KEY`, then rerun `./vibe-flow360 init`. If the dependency
cache is incomplete, run:

```bash
make cad-runtime
```

## Preflight fails

Read the issue path and message, edit the Draft, save it, and validate the new
revision. The execution button only applies to the latest saved and valid
revision. Ask AI may propose a patch, but review its before/after diff.

## A submitted run was interrupted locally

Reopen the persisted plan and use its recovery action. Recovery reconciles the
known Flow360 resource IDs and status; do not create another run merely because
the local server restarted.

## Tests

Run the complete repository gate with:

```bash
make test
```

Validate tutorial packages separately with:

```bash
make tutorials-test
```
