# Web typography

The Web UI uses a small semantic type scale instead of component-specific pixel sizes.
The canonical values live in `web/src/styles.css` under `:root`.

## Font families

| Role | Token | Stack | Usage |
| --- | --- | --- | --- |
| Interface | `--font-sans` | Manrope, PingFang SC, Microsoft YaHei, system sans | Titles, body copy, labels, controls and buttons |
| Technical | `--font-mono` | DM Mono, SFMono-Regular, Consolas, system mono | IDs, hashes, numeric evidence and compact machine states |

Monospace is not a general-purpose small-text style. It is reserved for content whose
alignment or machine identity matters.

## Type scale

| Role | Token | Size | Default weight |
| --- | --- | ---: | ---: |
| Metadata floor | `--text-xs` | 11 px | 400–500 |
| Secondary/body-small | `--text-sm` | 12 px | 400–500 |
| Primary body/control | `--text-md` | 14 px | 400–500 |
| Section/dialog title | `--text-lg` | 16 px | 600–700 |
| Page title | `--text-xl` | 20 px | 700 |

Do not introduce user-visible text below `--text-xs`. Use color, spacing and information
disclosure to reduce visual prominence rather than shrinking text below the readable floor.

## Line height and weight

- `--leading-compact` (`1.3`) is for headings, badges and single-line controls.
- `--leading-body` (`1.5`) is the normal interface and explanatory-copy line height.
- `--leading-relaxed` (`1.65`) is for longer guidance and documentation.
- Use regular (`400`) for body copy, medium (`500`) for controls and labels, semibold (`600`)
  for section emphasis, and bold (`700`) for primary titles.
- Do not use weight alone to communicate warning, error or success state.

## Component rules

- Form controls use at least `--text-md` and a 40–44 px minimum height in focused dialogs.
- Tooltip body text uses at least `--text-xs`; structured Tooltip titles use `--text-sm`.
- Dialog titles use `--text-lg`; dialog subtitles use `--text-sm`.
- Technical status labels may use `--font-mono`, but remain at least `--text-xs`.
- Verify both English and Chinese because fallback glyph metrics and line wrapping differ.
