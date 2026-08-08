import { describe, expect, it } from 'vitest'
import { detectSystemLanguage, languageStorageKey, readInitialLanguage } from './index'
import { localeOptions } from './locales'
import { hasTranslation, translate } from './translations'
import { t04Evidence, t04ParameterCards, t04Steps, validateT04Setup, t04Params } from '../tutorials/t04'
import { t01Evidence, t01ParameterCards, t01Steps, t01ParamsForAlpha, validateT01Setup } from '../tutorials/t01'
import { t02Paths, t02Steps } from '../tutorials/t02'
import { t03Evidence, t03ParameterCards, t03Steps, t03Params, validateT03Setup } from '../tutorials/t03'

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
    expect(hasTranslation('Review 3 Geometry warnings or unknown checks', 'zh-CN')).toBe(true)
    expect(hasTranslation('pressure distribution, 120 samples', 'zh-CN')).toBe(true)
    expect(hasTranslation('Remove boundary item 2', 'zh-CN')).toBe(true)
    expect(hasTranslation('Geometry AI multi-element airfoil strategy', 'zh-CN')).toBe(true)
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

  it('covers the complete AI Create session chrome in Chinese', () => {
    const messages = [
      'AI CREATE',
      'Describe the simulation you want',
      'Let’s define the simulation',
      'This session checkpoints exact CAD, the Flow360 Project, validated parameters, and the Draft independently. You can minimize it and continue working.',
      'Describe the geometry, dimensions, flow conditions, and engineering objective.',
      '0 / 4,000 characters',
      '500 characters remaining.',
      '25 over the limit — shorten the description to continue.',
      'Destination · Experiments',
      'Select a destination folder first',
      'Start with AI',
      'Live backend status',
      'In progress',
      'Design CAD',
      'Validate STEP',
      'Engineering details',
      'Clarification round 2',
      'Continue with answers',
      'AI Create is ready',
      'Project and Draft are ready to review.',
      'Working in the background…',
      'Retry current step',
      'Project and Draft are ready',
      'Open Project',
      'The session creates a reviewable configuration only. Paid remote meshing and solving still require approval.',
      'The AI Create model provider rejected its credentials. Check VIBESIM_AI_API_KEY and the configured provider account.',
      'The AI Create model provider is rate-limited or out of quota. Check the provider quota, then retry shortly.',
      'The AI Create model provider is temporarily unavailable after an automatic retry. Try again shortly.',
      'The AI Create model provider rejected the request. Check the configured base URL and model name.',
      'The AI Create model provider timed out. Try again shortly.',
      'The AI Create Agent is unavailable. Check the Agent configuration and try again.',
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

  it('covers the complete guided-tutorial data model in Chinese', () => {
    const messages = [
      ...t01Steps.flatMap(({ title, summary }) => [title, summary]),
      ...t01ParameterCards.flatMap(({ label, provenance, why }) => [label, provenance, why]),
      ...t01Evidence.flatMap(({ title, detail }) => [title, detail]),
      ...validateT01Setup(t01ParamsForAlpha(0)).flatMap(({ label, detail }) => [label, detail]),
      ...validateT01Setup(t01ParamsForAlpha(5)).flatMap(({ label, detail }) => [label, detail]),
      ...t02Steps.flatMap(({ title, summary }) => [title, summary]),
      ...Object.values(t02Paths).flatMap(({ root, required, skipped, best }) => [root, ...required, ...skipped, best]),
      ...t03Steps.flatMap(({ title, summary }) => [title, summary]),
      ...t03ParameterCards.flatMap(({ label, provenance, why }) => [label, provenance, why]),
      ...t03Evidence.flatMap(({ title, detail }) => [title, detail]),
      ...validateT03Setup(t03Params(false)).flatMap(({ label, detail }) => [label, detail]),
      ...validateT03Setup(t03Params(true)).flatMap(({ label, detail }) => [label, detail]),
    ]

    expect(messages.filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
  })
})
