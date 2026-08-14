# Projects and resources

The home workspace is organized around the connected Flow360 account.

## Folders and Projects

Select a Folder to load its Projects. Projects can be searched, filtered by
root resource type, sorted, and shown as a list or cards. Folders can be
created, renamed, moved, and deleted; Projects can be renamed and deleted.
These actions use dedicated dialogs, and irreversible deletion requires
explicit confirmation.

Opening a Project enters the Project workbench. Use **Resources** to navigate
the Geometry, SurfaceMesh, VolumeMesh, and Case tree. The selected resource
opens a workspace appropriate to its type.

## Synchronization

The application reads a recent local inventory first when available, then
refreshes live metadata. **Sync** requests a complete refresh. Partial failures
are reported per resource and can be retried without discarding the usable
parts of the mirror.

Initial synchronization does not download large result or mesh archives.
Geometry visualization manifests and buffers are fetched when the 3D preview is
opened and then reused locally.

## Bringing in geometry

The import workflow accepts supported CAD files, asks for the geometry unit,
and shows the intended Flow360 commands before processing. The STEP Library
stores immutable versions, previews validated versions, organizes assets into
local folders, and can create a Flow360 Project from a selected version.

AI Create accepts a natural-language geometry request when a model provider is
configured. It generates a constrained CAD operation graph, executes it with
the local CadQuery/OpenCascade runtime, and validates a closed solid before a
Project is created.

## Project tools

The workbench also provides Project-scoped annotations, Draft management, Ask
AI, and Case comparison when the Project contains Case resources.
