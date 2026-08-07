import { enLocale } from './en'
import type { LocalePack } from './types'
import { zhCNLocale } from './zh-CN'

const packs = [enLocale, zhCNLocale] as const

export type Language = typeof packs[number]['code']

const registry = Object.fromEntries(packs.map((pack) => [pack.code, pack])) as Record<Language, LocalePack>

export const localeOptions = packs.map(({ code, nativeName, displayName }) => ({ code, nativeName, displayName }))

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in registry
}
export function getLocale(language: Language): LocalePack {
  return registry[language]
}

export function detectRegisteredLanguage(languages?: readonly string[]): Language {
  for (const candidate of languages ?? []) {
    const normalized = candidate.toLowerCase()
    const exact = packs.find((pack) => pack.code.toLowerCase() === normalized)
    if (exact) return exact.code
    const prefix = packs.find((pack) => pack.systemPrefixes.some((value) => normalized === value || normalized.startsWith(`${value}-`)))
    if (prefix) return prefix.code
  }
  return enLocale.code
}
