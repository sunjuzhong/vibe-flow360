# Draft editor contracts

The Draft editor presents one candidate `SimulationParams` document through
Form, JSON, Preview, and AI surfaces. These surfaces must remain projections of
the same candidate; none of them may write to Flow360 implicitly.

## Candidate and history

- `baseline` is the last canonical document returned by Flow360.
- A user, JSON, or AI edit creates a local candidate and one history entry.
- Undo and redo operate on complete candidate documents. A successful save
  replaces the baseline and clears history; Discard restores that baseline.
- Unknown Flow360 fields must survive Form hydration/serialization and mode
  changes. JSON is the complete fallback when the installed schema cannot
  project a field.
- Responses are scoped to the Draft ID, request sequence, and candidate
  fingerprint. A late response must never replace a newer candidate or move
  focus.

## Validation, save, and run

Local syntax/schema errors block remote validation. Save then validates the
exact candidate again, blocks on errors, permits explicit warnings, and sends
that same fingerprint to the existing update API. Save failure preserves the
candidate and history for retry. Review & Run is enabled only when the current
candidate is clean, saved, and has a successful validation for the same Draft
ID and fingerprint.

AI always receives the current unsaved candidate. Its result enters the same
history and validation flow; it cannot bypass save or the run gate.

## `FieldShell` and input components

Every schema input uses `FieldShell` directly or through `InputField`. The
focusable control must consume the render callback's generated props:

- stable `id` and an associated `<label>` (or `aria-label` for hidden labels);
- `aria-describedby` for help, description, status, and all messages;
- `aria-invalid` plus `aria-errormessage` for the first blocking error;
- visible icon/text for error, warning, and success so color is never the only
  signal.

Composite controls put those props on their focusable group. Error navigation
opens the owning group, selects its Form tab, scrolls it into view, then focuses
the control. Async validation updates status through a polite live region but
must not move focus.

Schema titles and cleaned descriptions use the active locale when a translation
exists and otherwise fall back to the exact server text. Technical paths, IDs,
enum wire values, and unknown server error details remain unchanged.

## Dialog and responsive behavior

The Draft dialog and dirty-close alert dialog keep keyboard focus inside the
active modal, accept Escape where cancellation is safe, and restore focus to
the invoking control. Form/JSON tabs implement arrow, Home, and End navigation.
At widths below 920 px root groups use the select projection; below 680 px the
dialog becomes a full-width sheet; at 390 px toolbar and action controls wrap.
All activity indicators retain visible status text when reduced motion disables
animation.
