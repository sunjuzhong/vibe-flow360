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
    vi.spyOn(api, 'draftParameterSchema').mockResolvedValue({
      schema_version: 1,
      source_type: 'Case',
      stages: ['Case'],
      schema,
      baseline,
    })
    vi.spyOn(api, 'validateDraftParameters').mockResolvedValue(validation)
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

    expect(container.querySelectorAll('.draft-validation-popover-issues button')).toHaveLength(5)
    expect(container.querySelector('#schema-root-tab-meshing')?.getAttribute('aria-selected')).toBe('true')

    await click(buttonWithText(container, 'Maximum steps is invalid'))

    const caseTab = container.querySelector<HTMLElement>('#schema-root-tab-case')
    const maximumSteps = container.querySelector<HTMLInputElement>('#schema-case-solver-max_steps')
    expect(caseTab?.getAttribute('aria-selected')).toBe('true')
    expect(maximumSteps?.closest<HTMLDetailsElement>('.schema-root-field-section')?.open).toBe(true)
    expect(document.activeElement).toBe(maximumSteps)

    await click(buttonWithText(container, 'Next error'))
    const multiSelect = container.querySelector<HTMLElement>('#schema-case-output_fields')
    expect(multiSelect?.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(multiSelect)

    await click(buttonWithText(container, 'Monitors are invalid'))
    const entityList = container.querySelector<HTMLElement>('#schema-case-monitors')
    expect(entityList?.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(entityList)

    await click(buttonWithText(container, 'Output format is invalid'))
    const enumArrayUnion = container.querySelector<HTMLElement>('#schema-case-output_format')
    expect(enumArrayUnion?.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(enumArrayUnion)

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!maximumSteps || !valueSetter) throw new Error('Maximum steps input is unavailable')
    await act(async () => {
      valueSetter.call(maximumSteps, '10')
      maximumSteps.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.querySelector('.draft-validation-popover-issues')).toBeNull()
    expect(container.querySelectorAll('.schema-inline-error')).toHaveLength(0)
    expect(container.querySelectorAll('.schema-invalid, .schema-field-invalid, .input-field--invalid')).toHaveLength(0)
    expect(caseTab?.classList.contains('invalid')).toBe(false)
  })
})
