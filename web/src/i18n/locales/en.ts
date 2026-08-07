import type { LocalePack } from './types'

export const enLocale: LocalePack<'en'> = {
  code: 'en',
  nativeName: 'English',
  displayName: 'English',
  systemPrefixes: ['en'],
  documentTitle: 'Vibe Flow360 — Chat with your simulation',
  documentDescription: 'Vibe Flow360 — plan, run, and understand Flow360 CFD simulations with natural language.',
  translate: (value) => value,
}
