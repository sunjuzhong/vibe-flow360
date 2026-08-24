# Draft editor release acceptance

This is the reproducible release-gate record for the explicit-save Draft editor.

## Deterministic setup

1. Start the Web app and open a Case Draft with a schema containing two root
   groups, a nested numeric field, an array, and one unknown JSON field.
2. Repeat with English and Chinese selected. Use a long Draft name and inject
   fixtures for valid, warning, error, schema-unavailable, validation-network,
   and save-failure responses.
3. Set the viewport to 1440×900, 1024×768, 768×900, then 390×844. At each size
   open Form, JSON, Preview, validation details, AI, and the dirty-close dialog.
4. In DevTools enable reduced motion and repeat validation and save.

## Viewport record

| Width | Expected layout and acceptance evidence |
| --- | --- |
| 1440 | Centered editor, Form and AI side by side, fixed action bar visible; no page-level horizontal scroll. |
| 1024 | Centered editor stays within 40 px viewport gutters; root groups use the compact selector; validation details remain reachable. |
| 768 | AI becomes an in-dialog overlay; header identity and close action remain visible; Form has one scroll owner. |
| 390 | Full-width sheet; toolbar and action buttons wrap without clipping; long English/Chinese status copy wraps above actions. |

For every row, record screenshots of: clean/saved, unsaved, blocking error with
summary, warning, AI open, Preview, and dirty close. A passing record has no
horizontal overflow, hidden primary action, overlapping fixed bar, or competing
vertical scroll region.

## Keyboard and screen-reader script

- Enter the editor at its first useful control. Use arrow/Home/End keys across
  Form and JSON tabs, then Tab through fields, validation, AI, and actions in
  visual order.
- Trigger an error and use First error / Next error. The owning group opens and
  the related control receives focus; the later validation response does not
  take it away.
- Open dirty close. Focus enters Continue editing, Tab and Shift+Tab wrap inside
  the alert dialog, Escape returns to the close button, and save failure keeps
  the dialog open.
- Confirm each field announces label, help, technical path where present, and
  error. Confirm save/validation changes are announced once by the polite live
  region and that error/warning/success include icon and text.

## Automated evidence

The Web suite covers lossless serialization and unknown fields, Form/JSON
equivalence, unified history, explicit save, warning save, failed-save retry,
dirty close, Draft switching, stale/out-of-order requests, error focus, i18n
source copy, field ARIA relationships, and the exact-version Run gate. Run:

```sh
cd web
npm test
npm run build
cd ..
go test ./...
git diff --check
```

Real Flow360 smoke remains credential-dependent. With credentials, open a real
Draft, edit one reversible field, validate, save, simulate a failed retry where
possible, and verify Review & Run is disabled for every unsaved or unvalidated
revision. Do not approve or start paid work as part of this smoke test.

The release-gate status palettes were checked against their rendered surfaces:
error 5.98:1, warning 5.39:1, success 4.96:1, recovery title 6.69:1, and
recovery detail 5.69:1. Muted header and action copy was darkened to keep small
text at or above the WCAG AA 4.5:1 threshold.
