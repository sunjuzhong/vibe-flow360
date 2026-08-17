# T07 expected engineering review

## Domain interpretation

The imported CAD is the closed 8 m × 4 m × 4 m fluid volume. Its inlet,
outlet, walls, sphere, and supports bound the space occupied by air. The Draft
therefore uses `UserDefinedFarfield` to select the supplied domain and does not
generate an `AutomatedFarfield` outside it.

The `Primary duct fluid` seed at `[1, 0, 2] m` lies upstream of the sphere,
inside the connected passage, and away from every boundary. The same entity is
registered in the Draft entity catalog and referenced by `CustomZones`.

## Resolution decision

The sphere blocks about 19.6% of the duct section before the supports are
included. A global 1.2 m edge target cannot be accepted solely because schema
validation succeeds: the sphere silhouette, 0.2 m supports, floor layer, and
downstream recovery region must be inspected in the generated mesh.

The feature-aware Draft adds local surface constraints to the sphere and
supports, a floor boundary layer, and explicit adjacent/ceiling spacing
behavior. It keeps the CAD, domain path, seed point, project units, and global
defaults fixed, so differences in feature survival and cell cost can be
attributed to those local controls.

## Acceptance evidence

- Only the intended connected internal fluid volume is meshed.
- Every boundary group is present and no open edge or external region appears.
- The sphere is smooth enough for separation analysis and all supports survive.
- Floor layers remain continuous and grow smoothly into the core mesh.
- Wake-region growth remains gradual through the four-metre recovery length.
- Cell-quality hotspots and cell-count increase are reported for both Drafts.

No pressure-loss conclusion is made at this stage. Inlet/outlet physics,
operating conditions, solver convergence, and pressure evidence are added by
later tutorials.
