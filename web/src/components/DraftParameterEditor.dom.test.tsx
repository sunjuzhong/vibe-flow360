/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type DraftParameterValidationResponse, type DynamicFormSchema } from '../api/client'
import { I18nProvider } from '../i18n'
import DraftParameterEditor from './DraftParameterEditor'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const schema: DynamicFormSchema = {
  type: 'object',
  properties: {
    meshing: {
      type: 'object',
      title: 'Meshing',
      properties: {
        defaults: {
          type: 'object',
          title: 'Defaults',
          properties: { target_count: { type: 'integer', title: 'Target count' } },
        },
      },
    },
    case: {
      type: 'object',
      title: 'Case',
      properties: {
        solver: {
          type: 'object',
          title: 'Solver',
          properties: { max_steps: { type: 'integer', title: 'Maximum steps' } },
        },
        output_fields: {
          type: 'multi_select',
          title: 'Output fields',
          value_key: 'items',
          options: ['Cp', 'yPlus'],
        },
        monitors: {
          type: 'entity_list',
          title: 'Monitors',
          entity_choices: [{
            value: 'wing',
            label: 'Wing',
            payload: { name: 'Wing', private_attribute_id: 'wing' },
          }],
        },
        output_format: {
          type: 'union',
          title: 'Output format',
          variants: [
            { type: 'array', items: { type: 'enum', options: ['paraview', 'tecplot'] } },
            { type: 'enum', options: ['both'] },
          ],
        },
      },
    },
  },
}

const baseline = {
  meshing: { defaults: { target_count: 100 } },
  case: {
    solver: { max_steps: 0 },
    output_fields: { items: ['Cp'] },
    monitors: { stored_entities: [{ name: 'Wing', private_attribute_id: 'wing' }] },
    output_format: ['paraview'],
  },
}

const validation: DraftParameterValidationResponse = {
  schema_version: 1,
  valid: false,
  issues: [
    { level: 'error', code: 'invalid', path: 'meshing.defaults.target_count', message: 'Target count is invalid' },
    { level: 'error', code: 'invalid', path: 'case.solver.max_steps', message: 'Maximum steps is invalid' },
    { level: 'error', code: 'invalid', path: 'case.output_fields', message: 'Output fields are invalid' },
    { level: 'error', code: 'invalid', path: 'case.monitors', message: 'Monitors are invalid' },
    { level: 'error', code: 'invalid', path: 'case.output_format', message: 'Output format is invalid' },
  ],
}

function buttonWithText(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flushTimers()
}

async function flushTimers() {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
  })
}

describe('Draft parameter validation navigation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
    })
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: (handle: number) => window.clearTimeout(handle),
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
    })
    vi.spyOn(api, 'draftParameterSchema').mockResolvedValue({
      schema_version: 1,
      source_type: 'Case',
      stages: ['Case'],
      schema,
      baseline,
    })
    vi.spyOn(api, 'validateDraftParameters').mockResolvedValue(validation)
    vi.spyOn(api, 'updateDraftParameters').mockResolvedValue({ simulation_params: baseline })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('navigates errors across tabs and clears every stale projection after the fingerprint changes', async () => {
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-1" parameters={baseline} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()

    expect(container.querySelectorAll('.draft-validation-popover-issues button')).toHaveLength(0)
    expect(container.querySelectorAll('.draft-editor-modes [role="tab"]')).toHaveLength(2)
    expect(buttonWithText(container, 'Preview').getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('.schema-root-select select')).not.toBeNull()
    expect(container.querySelector('#schema-root-tab-meshing')?.textContent).toContain('errors')
    expect(container.querySelector('#schema-root-tab-meshing')?.getAttribute('aria-selected')).toBe('true')

    const meshingTab = container.querySelector<HTMLElement>('#schema-root-tab-meshing')!
    await act(async () => meshingTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(container.querySelector('#schema-root-tab-case')?.getAttribute('aria-selected')).toBe('true')
    await act(async () => container.querySelector<HTMLElement>('#schema-root-tab-case')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    expect(meshingTab.getAttribute('aria-selected')).toBe('true')

    await click(buttonWithText(container, 'First error'))
    await click(buttonWithText(container, 'Next error'))

    const caseTab = container.querySelector<HTMLElement>('#schema-root-tab-case')
    const maximumSteps = container.querySelector<HTMLInputElement>('#schema-case-solver-max_steps')
    expect(caseTab?.getAttribute('aria-selected')).toBe('true')
    expect(maximumSteps?.closest<HTMLDetailsElement>('.schema-root-field-section')?.open).toBe(true)
    expect(document.activeElement).toBe(maximumSteps)

    await click(buttonWithText(container, 'Next error'))
    const multiSelect = container.querySelector<HTMLElement>('#schema-case-output_fields')
    expect(multiSelect?.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(multiSelect)

    await click(buttonWithText(container, 'Next error'))
    const entityList = container.querySelector<HTMLElement>('#schema-case-monitors')
    expect(entityList?.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(entityList)

    await click(buttonWithText(container, 'Next error'))
    const enumArrayUnion = container.querySelector<HTMLElement>('#schema-case-output_format')
    expect(enumArrayUnion?.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(enumArrayUnion)

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!maximumSteps || !valueSetter) throw new Error('Maximum steps input is unavailable')
    maximumSteps.focus()
    await act(async () => {
      valueSetter.call(maximumSteps, '10')
      maximumSteps.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.querySelector('.draft-validation-popover-issues')).toBeNull()
    expect(container.querySelectorAll('.schema-inline-error')).toHaveLength(0)
    expect(container.querySelectorAll('.schema-invalid, .schema-field-invalid, .input-field--invalid')).toHaveLength(0)
    expect(caseTab?.classList.contains('invalid')).toBe(false)
    expect(document.activeElement).toBe(maximumSteps)
    await flushTimers()
    expect(document.activeElement).toBe(maximumSteps)
  })

  it('exposes connected mode tabs with roving arrow, Home, and End keyboard focus', async () => {
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-modes" parameters={baseline} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()

    const formMode = container.querySelector<HTMLElement>('#draft-editor-mode-form')!
    const jsonMode = container.querySelector<HTMLElement>('#draft-editor-mode-json')!
    expect(formMode.getAttribute('aria-controls')).toBe('draft-editor-panel-form')
    expect(container.querySelector('#draft-editor-panel-form')?.getAttribute('aria-labelledby')).toBe('draft-editor-mode-form')
    formMode.focus()
    await act(async () => formMode.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(jsonMode.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(jsonMode)
    await act(async () => jsonMode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(formMode.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(formMode)
  })

  it('shows warnings without error styling and routes an unmapped issue to complete JSON', async () => {
    vi.mocked(api.validateDraftParameters).mockResolvedValue({
      schema_version: 1,
      valid: false,
      issues: [
        { level: 'warning', code: 'review', path: 'case.output_fields', message: 'Review the selected outputs' },
        { level: 'error', code: 'hidden', path: 'private_attribute_cache.hidden', message: 'Inspect the complete candidate' },
      ],
    })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-1" parameters={baseline} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()

    await click(container.querySelector<HTMLElement>('#schema-root-tab-case')!)
    const warning = [...container.querySelectorAll('.field-shell__message--warning')].find((candidate) => candidate.textContent?.includes('Review the selected outputs'))
    expect(warning).toBeDefined()
    expect(container.querySelector('#schema-root-tab-case')?.textContent).toContain('warnings')

    const globalIssue = buttonWithText(container, 'Inspect the complete candidate')
    expect(globalIssue.textContent).toContain('General Draft issue')
    expect(globalIssue.textContent).toContain('No matching form field')
    await click(globalIssue)
    expect(buttonWithText(container, 'JSON').getAttribute('aria-selected')).toBe('true')
  })

  it('keeps the candidate recoverable when schema loading or validation transport fails', async () => {
    vi.mocked(api.draftParameterSchema).mockRejectedValueOnce(new Error('schema runtime unavailable'))
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-schema" parameters={baseline} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()

    expect(container.textContent).toContain('Flow360 form schema is unavailable')
    expect(buttonWithText(container, 'JSON').getAttribute('aria-selected')).toBe('true')
    await click(buttonWithText(container, 'Retry schema'))
    expect(buttonWithText(container, 'Form').hasAttribute('disabled')).toBe(false)

    vi.mocked(api.validateDraftParameters).mockRejectedValue(new TypeError('Failed to fetch'))
    await click(buttonWithText(container, 'Validate again'))
    expect(container.textContent).toContain('Validation connection failed')
    expect(container.textContent).toContain('candidate is still local')
    expect(buttonWithText(container, 'Retry validation')).not.toBeNull()
  })

  it('keeps edits local until explicit save and preserves them after a failed save', async () => {
    vi.mocked(api.validateDraftParameters).mockResolvedValue({ schema_version: 1, valid: true, issues: [] })
    vi.mocked(api.updateDraftParameters).mockRejectedValue(new Error('connection interrupted while saving'))
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-sync" parameters={baseline} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()

    await click(container.querySelector<HTMLElement>('#schema-root-tab-case')!)
    const input = container.querySelector<HTMLInputElement>('#schema-case-solver-max_steps')
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!input || !valueSetter) throw new Error('Maximum steps input is unavailable')
    await act(async () => {
      valueSetter.call(input, '20')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flushTimers()
    await flushTimers()

    expect(api.updateDraftParameters).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Unsaved local changes')
    await click(buttonWithText(container, 'Save to Draft'))

    expect(api.updateDraftParameters).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Draft save failed')
    expect(container.textContent).toContain('candidate and its edit history remain local')
    expect(buttonWithText(container, 'Retry save')).not.toBeNull()
  })

  it('undoes and redoes Form and external AI changes in one candidate history', async () => {
    const applied = vi.fn()
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-history" parameters={baseline} onExternalPatchApplied={applied} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await click(container.querySelector<HTMLElement>('#schema-root-tab-case')!)
    const input = container.querySelector<HTMLInputElement>('#schema-case-solver-max_steps')
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!input || !valueSetter) throw new Error('Maximum steps input is unavailable')
    await act(async () => {
      valueSetter.call(input, '20')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor
        draftId="draft-history"
        parameters={baseline}
        externalPatch={{ id: 7, draftId: 'draft-history', patch: { case: { solver: { max_steps: 30 } } } }}
        onExternalPatchApplied={applied}
      /></I18nProvider>)
      await Promise.resolve()
    })
    expect(applied).toHaveBeenCalledWith(7)
    expect(input.value).toBe('30')

    await click(buttonWithText(container, 'Undo'))
    expect(input.value).toBe('20')
    await click(buttonWithText(container, 'Undo'))
    expect(input.value).toBe('0')
    await click(buttonWithText(container, 'Redo'))
    expect(input.value).toBe('20')
    expect(api.updateDraftParameters).not.toHaveBeenCalled()
  })

  it('saves a warning-only exact candidate once and establishes a clean baseline', async () => {
    vi.mocked(api.validateDraftParameters).mockResolvedValue({
      schema_version: 1,
      valid: true,
      issues: [{ level: 'warning', code: 'review', path: 'case.solver.max_steps', message: 'Review the iteration count' }],
    })
    vi.mocked(api.updateDraftParameters).mockImplementation(async (_draftId, parameters) => ({ simulation_params: parameters }))
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-warning" parameters={baseline} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await click(container.querySelector<HTMLElement>('#schema-root-tab-case')!)
    const input = container.querySelector<HTMLInputElement>('#schema-case-solver-max_steps')
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!input || !valueSetter) throw new Error('Maximum steps input is unavailable')
    await act(async () => {
      valueSetter.call(input, '25')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flushTimers()
    await click(buttonWithText(container, 'Save to Draft'))

    expect(api.updateDraftParameters).toHaveBeenCalledTimes(1)
    expect(api.updateDraftParameters).toHaveBeenCalledWith(
      'draft-warning',
      expect.objectContaining({ case: expect.objectContaining({ solver: { max_steps: 25 } }) }),
      undefined,
    )
    expect(container.textContent).toContain('Draft matches the saved Flow360 version')
    expect(buttonWithText(container, 'Discard changes').hasAttribute('disabled')).toBe(true)
  })
})
