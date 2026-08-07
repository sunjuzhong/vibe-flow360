import { createContext, Fragment, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { detectRegisteredLanguage, getLocale, isLanguage, type Language } from './locales'
import { translate } from './translations'

export type { Language } from './locales'

export const languageStorageKey = 'vibesim.settings.language'

type LanguageContextValue = {
  language: Language
  setLanguage: (language: Language) => void
  t: (value: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

let activeLanguage: Language = 'en'

export function detectSystemLanguage(languages?: readonly string[]): Language {
  return detectRegisteredLanguage(languages)
}

export function readInitialLanguage(
  storage?: Pick<Storage, 'getItem'>,
  languages?: readonly string[],
): Language {
  try {
    const stored = storage?.getItem(languageStorageKey)
    if (isLanguage(stored)) return stored
  } catch {
    // Storage can be unavailable in privacy modes; system detection still works.
  }
  return detectSystemLanguage(languages)
}

function browserInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'en'
  return readInitialLanguage(window.localStorage, navigator.languages?.length ? navigator.languages : [navigator.language])
}

export function currentLanguage() {
  return activeLanguage
}

export function localizeValue(value: unknown): unknown {
  if (activeLanguage === 'en') return value
  if (typeof value === 'string') return translate(value, activeLanguage)
  if (Array.isArray(value)) return value.map(localizeValue)
  return value
}

export function localizeProps(props: Record<string, unknown> | null) {
  if (!props || activeLanguage === 'en') return props
  const localized = { ...props }
  if ('children' in localized) localized.children = localizeValue(localized.children)
  for (const name of ['aria-label', 'aria-description', 'placeholder', 'title', 'alt']) {
    if (typeof localized[name] === 'string') localized[name] = translate(localized[name] as string, activeLanguage)
  }
  return localized
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<Language>(browserInitialLanguage)
  activeLanguage = language

  useEffect(() => {
    activeLanguage = language
    const locale = getLocale(language)
    document.documentElement.lang = language
    document.title = locale.documentTitle
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute(
      'content',
      locale.documentDescription,
    )
    try {
      window.localStorage.setItem(languageStorageKey, language)
    } catch {
      // The setting remains active for this session when persistence is blocked.
    }
  }, [language])

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage: updateLanguage,
    t: (text) => translate(text, language),
  }), [language])

  return <LanguageContext.Provider value={value}><Fragment key={language}>{children}</Fragment></LanguageContext.Provider>
}

export function useI18n() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
