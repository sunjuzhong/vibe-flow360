import { describe, expect, it } from 'vitest'
import { detectSystemLanguage, languageStorageKey, readInitialLanguage } from './index'
import { localeOptions } from './locales'
import { hasTranslation, translate } from './translations'
import { t04Evidence, t04ParameterCards, t04Steps, validateT04Setup, t04Params, t04Pedagogy } from '../tutorials/t04'
import { t01Evidence, t01ParameterCards, t01Steps, t01ParamsForAlpha, t01Pedagogy, validateT01Setup } from '../tutorials/t01'
import { t02Evidence, t02ParameterCards, t02Steps, t02Params, t02Pedagogy, validateT02Setup } from '../tutorials/t02'
import { t03Evidence, t03ParameterCards, t03Steps, t03Params, t03Pedagogy, validateT03Setup } from '../tutorials/t03'
import { t05Evidence, t05ParameterCards, t05Steps, t05Params, t05Pedagogy, validateT05Setup } from '../tutorials/t05'
import { t06Evidence, t06ParameterCards, t06Steps, t06Params, t06Pedagogy, validateT06Setup } from '../tutorials/t06'
import { tutorialPedagogyCopy } from '../tutorials/pedagogy'

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
    expect(translate('3 available', 'zh-CN')).toBe('3 个可用教程')
    expect(translate('Open Demo wing', 'zh-CN')).toBe('打开 Demo wing')
    expect(hasTranslation('Review 3 Geometry warnings or unknown checks', 'zh-CN')).toBe(true)
    expect(hasTranslation('pressure distribution, 120 samples', 'zh-CN')).toBe(true)
    expect(hasTranslation('Remove boundary item 2', 'zh-CN')).toBe(true)
    expect(hasTranslation('Geometry AI multi-element airfoil strategy', 'zh-CN')).toBe(true)
    expect(translate('Settings', 'en')).toBe('Settings')
  })

  it('covers the new Project source selector in Chinese', () => {
    const messages = [
      'Project source method',
      'Upload files',
      'STEP geometry library',
      'Version',
      'Choose STEP geometry',
      'Validated STEP geometry',
      'Geometry type and length unit come from the selected immutable version.',
      'No validated STEP versions are available.',
      'Review project',
      'Reviewed STEP geometry',
    ]

    expect(messages.filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
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

  it('translates Case convergence trend values', () => {
    expect(translate('stable', 'zh-CN')).toBe('稳定')
    expect(translate('increasing', 'zh-CN')).toBe('上升')
    expect(translate('decreasing', 'zh-CN')).toBe('下降')
    expect(translate('Not Converged — Results show drift or instability', 'zh-CN')).toBe('未收敛 — 结果存在漂移或不稳定')
    expect(translate('Residual Convergence', 'zh-CN')).toBe('残差收敛')
    expect(translate('Completed', 'zh-CN')).toBe('已完成')
    expect(translate('Completed at', 'zh-CN')).toBe('完成时间')
    expect(translate('2_momy oscillating', 'zh-CN')).toBe('2_momy 振荡')
  })

  it('translates the viewer color range control', () => {
    expect(translate('Color range', 'zh-CN')).toBe('颜色范围')
    expect(translate('Minimum color range', 'zh-CN')).toBe('颜色范围最小值')
    expect(translate('Maximum color range', 'zh-CN')).toBe('颜色范围最大值')
    expect(translate('Values outside this range use the endpoint colors', 'zh-CN')).toBe('范围外的数值使用色带两端颜色')
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
      'Agent recommendation',
      '4 Agent recommendations prefilled',
      'Review the highlighted values, then confirm or change only what is necessary.',
      'Confirm recommended values & continue',
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
      ...tutorialPedagogyCopy(t04Pedagogy),
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
      ...tutorialPedagogyCopy(t01Pedagogy),
      ...t02Steps.flatMap(({ title, summary }) => [title, summary]),
      ...t02ParameterCards.flatMap(({ label, provenance, why }) => [label, provenance, why]),
      ...t02Evidence.flatMap(({ title, detail }) => [title, detail]),
      ...validateT02Setup(t02Params(false)).flatMap(({ label, detail }) => [label, detail]),
      ...validateT02Setup(t02Params(true)).flatMap(({ label, detail }) => [label, detail]),
      ...tutorialPedagogyCopy(t02Pedagogy),
      ...t03Steps.flatMap(({ title, summary }) => [title, summary]),
      ...t03ParameterCards.flatMap(({ label, provenance, why }) => [label, provenance, why]),
      ...t03Evidence.flatMap(({ title, detail }) => [title, detail]),
      ...validateT03Setup(t03Params(false)).flatMap(({ label, detail }) => [label, detail]),
      ...validateT03Setup(t03Params(true)).flatMap(({ label, detail }) => [label, detail]),
      ...tutorialPedagogyCopy(t03Pedagogy),
      ...t05Steps.flatMap(({ title, summary }) => [title, summary]),
      ...t05ParameterCards.flatMap(({ label, provenance, why }) => [label, provenance, why]),
      ...t05Evidence.flatMap(({ title, detail }) => [title, detail]),
      ...validateT05Setup(t05Params(false)).flatMap(({ label, detail }) => [label, detail]),
      ...validateT05Setup(t05Params(true)).flatMap(({ label, detail }) => [label, detail]),
      ...tutorialPedagogyCopy(t05Pedagogy),
      ...t06Steps.flatMap(({ title, summary }) => [title, summary]),
      ...t06ParameterCards.flatMap(({ label, provenance, why }) => [label, provenance, why]),
      ...t06Evidence.flatMap(({ title, detail }) => [title, detail]),
      ...validateT06Setup(t06Params('automatic')).flatMap(({ label, detail }) => [label, detail]),
      ...validateT06Setup(t06Params('compact')).flatMap(({ label, detail }) => [label, detail]),
      ...validateT06Setup(t06Params('manual')).flatMap(({ label, detail }) => [label, detail]),
      ...tutorialPedagogyCopy(t06Pedagogy),
    ]

    expect(messages.filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
  })

  it('covers the complete T05 environment builder in Chinese', () => {
    const messages = [
      'VOLUME MESHING',
      'WAKE REFINEMENT',
      'Focused cylinder wake refinement strategy',
      'Compact cylinder wake refinement strategy',
      'Tutorial T05 · cylinder wake refinement',
      'Build the T05 wake-mesh environment',
      'The app uploads the bundled cylinder geometry, registers the Sphere, Box, Cylinder, and Slice entities, and creates compact-wake and focused-wake VolumeMesh Drafts.',
      'Registered near-body sphere, structured wake box, axisymmetric core, directional spacing, center-plane slice',
      'Compact wake regions',
      'Focused wake corridor',
      'Both Draft entity catalogs and VolumeMesh parameter sets are synced. No surface or volume mesh computation has been submitted.',
      'The bundled T05 parameters contain an unregistered Draft entity or invalid refinement relationship.',
    ]
    expect(messages.filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
  })

  it('covers the complete T02 environment builder in Chinese', () => {
    const messages = [
      'OPERATING CONDITIONS',
      'WIND-TUNNEL SIMILARITY',
      'Build the T02 wind-tunnel experiment',
      'The app uploads the bundled aircraft CAD and creates Mach-only and Mach-plus-Reynolds Case Drafts with complete parameters.',
      'Mach 0.18, alpha 4°, 288.15 K, 2.4 m chord, ambient and Reynolds-matched densities',
      'Mach only · Re 10.1M',
      'Mach + Reynolds · Re 6.0M',
      'Both Case Draft parameter sets are synced. No surface mesh, volume mesh, or solver Case has been submitted.',
      'Create Project + 2 Case Drafts',
      'Tutorial T02 · wind-tunnel similarity',
    ]
    expect(messages.filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
  })
})
