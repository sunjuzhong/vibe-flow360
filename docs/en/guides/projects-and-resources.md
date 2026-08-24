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

## Editing a Draft

Draft configuration uses an explicit-save workflow. Form, JSON, and AI changes
all update one local candidate and do not update the remote Flow360 Draft until
you choose **Save to Draft**. Undo and redo span all three edit sources, while
**Discard changes** restores the last successfully saved version.

Saving validates the exact candidate again. Errors block the write and link to
the affected field; warnings remain visible but do not block saving. A failed
save preserves the candidate and its history so the same version can be retried.
Closing with unsaved changes offers **Continue editing**, **Discard changes**,
or **Save and close**. Running is available only while the current exact version
is both saved and validated; any subsequent edit disables it immediately.

This replaces the previous automatic Draft update behavior. Existing Flow360
schema, validation, and update API contracts are unchanged.

If schema loading fails, continue in JSON and retry the Form schema later. If
validation or saving fails, keep the editor open: the candidate and its undo
history remain local, and **Retry validation** or **Retry save** resubmits the
same version. Never discard changes merely to recover a network connection.

Keyboard users can move between Form and JSON with arrow, Home, and End keys.
Validation summary actions focus the affected field. The unsaved-close dialog
keeps focus inside until a choice is made and returns focus to the close button
when editing continues.
