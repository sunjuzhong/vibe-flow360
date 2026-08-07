import { getLocale, type Language } from './locales'

export function translate(value: string, language: Language): string {
  return getLocale(language).translate(value)
}

export function hasTranslation(value: string, language: Language): boolean {
  return language === 'en' || translate(value, language) !== value
}
