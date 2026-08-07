import { describe, expect, it } from 'vitest'
import { detectSystemLanguage, languageStorageKey, readInitialLanguage } from './index'
import { localeOptions } from './locales'
import { hasTranslation, translate } from './translations'
import { t04Evidence, t04ParameterCards, t04Steps, validateT04Setup, t04Params } from '../tutorials/t04'

describe('language settings', () => {
  it('uses Chinese for Chinese system locales and English otherwise', () => {
    expect(detectSystemLanguage(['zh-CN'])).toBe('zh-CN')
    expect(detectSystemLanguage(['zh-Hant-TW'])).toBe('zh-CN')
    expect(detectSystemLanguage(['en-US'])).toBe('en')
    expect(detectSystemLanguage([])).toBe('en')
  })

  it('registers locale packs as the source for language options', () => {
    expect(localeOptions).toEqual([
      { code: 'en', nativeName: 'English', displayName: 'English' },
      { code: 'zh-CN', nativeName: '中文', displayName: 'Chinese' },
    ])
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

  it('covers the dynamic VolumeMesh engineering review in Chinese', () => {
    const messages = [
      'VOLUME MESH REVIEW',
      'Engineering review required',
      'Missing data remains visible as missing or proxy evidence; review it before relying on this mesh.',
      '1 warnings / missing',
      'warnings / missing',
      'Status ·',
      'Status · completed',
      'Computing domain',
      'Diagnostic data coverage',
      'Meshing lifecycle completed',
      'Current status: completed',
      'Real VolumeMesh evidence is loaded',
      'The viewer is using the selected VolumeMesh asset.',
      'Cell count is reported',
      'No cell count was reported by Flow360.',
      'Zone inventory is available',
      '21 render groups reported.',
      'Cell-quality evidence is available',
      '6 scalar quality fields available.',
      'Volume meshing parameters are traceable',
      '7 volume-meshing parameter group entries found.',
      'Boundary-layer intent is traceable',
      '0 local rule(s) and 1 generated evidence field(s) are available.',
      'No partial Flow360 reads were reported',
      'All resource reads succeeded.',
    ]

    expect(messages.filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
  })

  it('covers the T04 tutorial and expression editor in Chinese', () => {
    const tutorialData = [
      ...t04Steps.flatMap(({ title, summary }) => [title, summary]),
      ...t04ParameterCards.flatMap(({ label, provenance, why }) => [label, provenance, why]),
      ...t04Evidence.flatMap(({ title, detail }) => [title, detail]),
      ...validateT04Setup(t04Params(false)).flatMap(({ label, detail }) => [label, detail]),
      ...validateT04Setup(t04Params(true)).flatMap(({ label, detail }) => [label, detail]),
    ]
    const pageAndEditorCopy = [
      'ADVANCED MESHING',
      'Preserve critical edges and narrow gaps',
      'Which small geometric feature will fail first in a global mesh?',
      'Geometry AI replaces edge rules; it does not layer on top of them.',
      'Parameter validity does not prove the gaps survived meshing.',
      'Create both Drafts without starting cloud meshing.',
      'Build the T04 airfoil mesh environment',
      'Create Project + 2 VolumeMesh Drafts',
      '  I reviewed the destination and authorize creation of this remote Flow360 Project and two configured ',
      ' Drafts. Nothing is submitted until I review and run a Draft. ',
      'Enter an expression before validation.',
      'Use ** for powers; Flow360 does not allow ^ in typed expressions.',
      'Checking with the installed Flow360 schema…',
      'Compile-time expression',
      'Expression suggestions',
      'Velocity expression',
      'Velocity requires an expression.',
      '3/4 reviewed',
    ]

    expect([...tutorialData, ...pageAndEditorCopy].filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
  })
})
