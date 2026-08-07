import { describe, expect, it } from 'vitest'
import { detectSystemLanguage, languageStorageKey, readInitialLanguage } from './index'
import { translate } from './translations'

describe('language settings', () => {
  it('uses Chinese for Chinese system locales and English otherwise', () => {
    expect(detectSystemLanguage(['zh-CN'])).toBe('zh-CN')
    expect(detectSystemLanguage(['zh-Hant-TW'])).toBe('zh-CN')
    expect(detectSystemLanguage(['en-US'])).toBe('en')
    expect(detectSystemLanguage([])).toBe('en')
  })

  it('prefers a persisted supported language and ignores invalid values', () => {
    expect(readInitialLanguage({ getItem: (key) => key === languageStorageKey ? 'en' : null }, ['zh-CN'])).toBe('en')
    expect(readInitialLanguage({ getItem: () => 'fr' }, ['zh-CN'])).toBe('zh-CN')
    expect(readInitialLanguage({ getItem: () => { throw new Error('blocked') } }, ['zh-CN'])).toBe('zh-CN')
  })

  it('translates exact, whitespace-preserving, and dynamic interface copy', () => {
    expect(translate('Settings', 'zh-CN')).toBe('设置')
    expect(translate('  Save ', 'zh-CN')).toBe('  保存 ')
    expect(translate('Step 2 of 6', 'zh-CN')).toBe('第 2 步，共 6 步')
    expect(translate('Open Demo wing', 'zh-CN')).toBe('打开 Demo wing')
    expect(translate('Settings', 'en')).toBe('Settings')
  })
})
