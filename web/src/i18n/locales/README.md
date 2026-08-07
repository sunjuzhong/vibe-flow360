# Locale packs

Each supported language is an independent `LocalePack` in this directory.

To add a language:

1. Add a pack such as `ja.ts` with its code, names, system-language prefixes,
   document metadata, and message translator.
2. Import the pack and append it to `packs` in `index.ts`.
3. Add coverage tests for the new pack's critical product surfaces.

The language selector and the `Language` TypeScript union are derived from the
registry. English is the source locale and therefore returns source copy. The
custom JSX runtime remains a migration bridge for existing components: visible
strings and accessibility attributes are routed through the selected pack.
New programmatic copy should call `useI18n().t` explicitly, rather than adding
component-specific language conditionals.
