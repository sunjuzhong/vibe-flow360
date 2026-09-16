/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type DraftParameterSchemaResponse, type DynamicFormSchema } from '../api/client'
import { I18nProvider } from '../i18n'
import DraftParametersDialog from './DraftParametersDialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const schema: DynamicFormSchema = {
  type: 'object',
  properties: {
    solver: { type: 'object', properties: { max_steps: { type: 'integer', title: 'Maximum steps' } } },
  },
}
const baseline = { solver: { max_steps: 10 } }
const preloadedSchema: DraftParameterSchemaResponse = { schema_version: 1, source_type: 'Case', stages: ['Case'], schema, baseline }

function button(container: HTMLElement, text: string) {
  const result = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(text))
  if (!result) throw new Error(`Button not found: ${text}`)
  return result
}

async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await act(async () => {
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
  })
}

describe('DraftParametersDialog close protection', () => {
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
    vi.spyOn(api, 'draftParameterSchema').mockResolvedValue({
      schema_version: 1,
      source_type: 'Case',
      stages: ['Case'],
      schema,
      baseline,
    })
    vi.spyOn(api, 'validateDraftParameters').mockResolvedValue({ schema_version: 1, valid: true, issues: [] })
    vi.spyOn(api, 'updateDraftParameters').mockRejectedValue(new Error('offline'))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('saves Draft settings changes even when Flow360 validation reports errors', async () => {
    vi.mocked(api.validateDraftParameters).mockResolvedValue({
      schema_version: 1,
      valid: false,
      issues: [{ level: 'error', code: 'invalid', path: 'models', message: 'Review model setup' }],
    })
    vi.mocked(api.updateDraftParameters).mockImplementation(async (_draftId, parameters) => ({ simulation_params: parameters }))
    const onSynced = vi.fn()
    await act(async () => {
      root.render(<I18nProvider><DraftParametersDialog
        draftId="draft-settings-save"
        draftName="Settings save"
        detail={{ id: 'draft-settings-save', type: 'Draft', simulation_params: baseline }}
        loading={false}
        error=""
        preloadedSchema={preloadedSchema}
        onClose={() => undefined}
        onRetry={() => undefined}
        onParametersSynced={onSynced}
      /></I18nProvider>)
      await Promise.resolve()
    })
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
    })

    await click(container.querySelector<HTMLElement>('[aria-label="Open Draft settings"]')!)
    const selects = container.querySelectorAll<HTMLSelectElement>('.draft-settings-panel select')
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    if (!selects[1] || !valueSetter) throw new Error('Project length unit select is unavailable')
    await act(async () => {
      valueSetter.call(selects[1], 'mm')
      selects[1].dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(button(container, 'Apply settings'))
    await click(button(container, 'Save to Draft'))

    expect(api.updateDraftParameters).toHaveBeenCalledTimes(1)
    expect(api.updateDraftParameters).toHaveBeenCalledWith(
      'draft-settings-save',
      expect.objectContaining({
        private_attribute_asset_cache: expect.objectContaining({
          project_length_unit: { value: 1, units: 'mm' },
        }),
      }),
      undefined,
    )
    expect(onSynced).toHaveBeenCalledWith(expect.objectContaining({
      private_attribute_asset_cache: expect.objectContaining({
        project_length_unit: { value: 1, units: 'mm' },
      }),
    }))
  })

  it('keeps editing on cancel or save failure and discards only on explicit choice', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(<I18nProvider><DraftParametersDialog
        draftId="draft-close"
        draftName="Close guard"
        detail={{ id: 'draft-close', type: 'Draft', simulation_params: baseline }}
        loading={false}
        error=""
        preloadedSchema={preloadedSchema}
        onClose={onClose}
        onRetry={() => undefined}
      /></I18nProvider>)
      await Promise.resolve()
    })
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
    })
    expect(api.draftParameterSchema).not.toHaveBeenCalled()
    const input = container.querySelector<HTMLInputElement>('#schema-solver-max_steps')
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!input || !valueSetter) throw new Error('Maximum steps input is unavailable')
    await act(async () => {
      valueSetter.call(input, '20')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const closeButton = container.querySelector<HTMLElement>('[aria-label="Close Draft configuration"]')!
    closeButton.focus()
    await click(closeButton)
    const guard = container.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(guard.getAttribute('aria-describedby')).toBe('draft-close-guard-description')
    expect(document.activeElement?.textContent).toContain('Continue editing')
    const guardButtons = guard.querySelectorAll<HTMLButtonElement>('button')
    guardButtons[guardButtons.length - 1].focus()
    await act(async () => guardButtons[guardButtons.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(document.activeElement).toBe(guardButtons[0])
    await click(button(container, 'Continue editing'))
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.activeElement).toBe(closeButton)
    expect(onClose).not.toHaveBeenCalled()

    await click(container.querySelector('[aria-label="Close Draft configuration"]')!)
    await click(button(container, 'Save and close'))
    expect(api.updateDraftParameters).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    await click(button(container.querySelector<HTMLElement>('[role="alertdialog"]')!, 'Discard changes'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
