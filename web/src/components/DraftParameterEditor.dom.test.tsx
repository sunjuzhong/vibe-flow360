/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type ChatSession, type DraftParameterValidationResponse, type DynamicFormSchema, type ProjectInfo, type ResourceNode } from '../api/client'
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
          properties: {
            target_count: { type: 'integer', title: 'Target count' },
            geometry_accuracy: { type: 'number', title: 'Geometry Accuracy' },
          },
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
  meshing: { defaults: { target_count: 100, geometry_accuracy: 0.01 } },
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

async function press(element: Element, key: string, shiftKey = false) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
  })
  await flushTimers()
}

async function flushTimers() {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const aiEditResponse = (value: number, message = 'Updated target count.') => ({
  mode: 'edit' as const,
  action: { version: 'v1' as const, kind: 'update-draft' as const, message, proposals: [] },
  proposal: {
    id: 'target-count', action: 'Geometry', target: 'draft', name: 'Target count', intent: 'Set target count',
    patch: { meshing: { defaults: { target_count: value } } }, branch_preview: 'target-count', fields: [],
  },
})

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
    vi.spyOn(api, 'agentChatSession').mockResolvedValue({
      project_id: 'project-1',
      scope_type: 'draft',
      scope_id: 'draft',
      messages: [],
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('uses a preloaded schema without a duplicate schema request or loading state', async () => {
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor
        draftId="draft-preloaded"
        parameters={baseline}
        preloadedSchema={{ schema_version: 1, source_type: 'Case', stages: ['Case'], schema, baseline }}
      /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()

    expect(api.draftParameterSchema).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Loading the installed Flow360 schema…')
    expect(container.querySelector('#schema-meshing-defaults-target_count')).not.toBeNull()
  })

  it('opens the AI Draft session with a field-specific explanation prompt', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const resource: ResourceNode = { id: 'resource-1', name: 'Case', type: 'Case', children: [] }
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-explain" parameters={baseline} project={project} resource={resource} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()

    const action = container.querySelector<HTMLButtonElement>('.schema-field-ai-explain')
    expect(action).not.toBeNull()
    expect(action?.getAttribute('aria-label')).toContain('Explain')
    await click(action!)

    const session = container.querySelector<HTMLElement>('.draft-ai-session')
    const prompt = container.querySelector<HTMLTextAreaElement>('.draft-ai-composer textarea')
    expect(session).not.toBeNull()
    expect(prompt?.value).toContain('meshing.defaults')
    expect(prompt?.value).toContain('Do not change any values.')
  })

  it('restores only the active Draft AI session and ignores a stale session load', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const resource: ResourceNode = { id: 'resource-1', name: 'Case', type: 'Case', children: [] }
    let resolveFirst: (session: ChatSession) => void = () => undefined
    const firstSession = new Promise<ChatSession>((resolve) => { resolveFirst = resolve })
    const secondSession: ChatSession = {
      project_id: 'project-1', scope_type: 'draft', scope_id: 'draft-second',
      messages: [{ role: 'assistant', content: '# Second Draft\n\n- restored' }],
    }
    vi.mocked(api.agentChatSession).mockImplementation((_projectID, _scopeType, scopeID) => (
      scopeID === 'draft-first' ? firstSession : Promise.resolve(secondSession)
    ))

    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-first" parameters={baseline} project={project} resource={resource} /></I18nProvider>)
      await Promise.resolve()
    })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-second" parameters={baseline} project={project} resource={resource} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()

    await click(container.querySelector<HTMLInputElement>('.draft-ai-toggle input')!)
    expect(container.textContent).toContain('Second Draft')
    expect(container.textContent).not.toContain('First Draft')
    expect(api.agentChatSession).toHaveBeenLastCalledWith('project-1', 'draft', 'draft-second')

    await act(async () => {
      resolveFirst({
        project_id: 'project-1', scope_type: 'draft', scope_id: 'draft-first',
        messages: [{ role: 'assistant', content: '# First Draft' }],
      })
      await Promise.resolve()
    })
    await flushTimers()

    expect(container.textContent).toContain('Second Draft')
    expect(container.textContent).not.toContain('First Draft')
  })

  it('rejects a stale AI success after an A-to-B-to-A source replacement', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const sourceA: ResourceNode = { id: 'source-a', name: 'Source A', type: 'Geometry', children: [] }
    const sourceB: ResourceNode = { id: 'source-b', name: 'Source B', type: 'Geometry', children: [] }
    const pending = deferred<Awaited<ReturnType<typeof api.assistPlanForm>>>()
    vi.spyOn(api, 'assistPlanForm').mockReturnValue(pending.promise)

    const render = async (resource: ResourceNode) => {
      await act(async () => {
        root.render(<I18nProvider><DraftParameterEditor draftId="draft-race" parameters={baseline} project={project} resource={resource} /></I18nProvider>)
        await Promise.resolve()
      })
      await flushTimers()
    }
    await render(sourceA)
    await click(container.querySelector<HTMLInputElement>('.draft-ai-toggle input')!)
    await click(buttonWithText(container, 'Modify parameters'))
    const form = container.querySelector<HTMLFormElement>('.draft-ai-composer')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(api.assistPlanForm).toHaveBeenCalledTimes(1)

    await render(sourceB)
    await render(sourceA)
    await act(async () => {
      pending.resolve(aiEditResponse(999, 'STALE A RESPONSE'))
      await Promise.resolve()
    })
    await flushTimers()

    expect(container.textContent).not.toContain('STALE A RESPONSE')
    expect(container.querySelector('.draft-ai-message-changes')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('.draft-parameter-save')?.disabled).toBe(true)
  })

  it('rejects stale AI errors after source replacement', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const sourceA: ResourceNode = { id: 'source-a', name: 'Source A', type: 'Geometry', children: [] }
    const sourceB: ResourceNode = { id: 'source-b', name: 'Source B', type: 'Geometry', children: [] }
    const pending = deferred<Awaited<ReturnType<typeof api.assistPlanForm>>>()
    vi.spyOn(api, 'assistPlanForm').mockReturnValue(pending.promise)

    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-error-race" parameters={baseline} project={project} resource={sourceA} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await click(container.querySelector<HTMLInputElement>('.draft-ai-toggle input')!)
    await click(buttonWithText(container, 'Modify parameters'))
    await act(async () => {
      container.querySelector<HTMLFormElement>('.draft-ai-composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-error-race" parameters={baseline} project={project} resource={sourceB} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await act(async () => {
      pending.reject(new Error('STALE FAILURE'))
      await Promise.resolve()
    })
    await flushTimers()

    expect(container.textContent).not.toContain('STALE FAILURE')
    expect(container.querySelector('.draft-ai-message.error')).toBeNull()
  })

  it('keeps the current request loading when an older request settles and blocks duplicate submits synchronously', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const sourceA: ResourceNode = { id: 'source-a', name: 'Source A', type: 'Geometry', children: [] }
    const sourceB: ResourceNode = { id: 'source-b', name: 'Source B', type: 'Geometry', children: [] }
    const first = deferred<Awaited<ReturnType<typeof api.assistPlanForm>>>()
    const second = deferred<Awaited<ReturnType<typeof api.assistPlanForm>>>()
    vi.spyOn(api, 'assistPlanForm').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const render = async (resource: ResourceNode) => {
      await act(async () => {
        root.render(<I18nProvider><DraftParameterEditor draftId="draft-finally-race" parameters={baseline} project={project} resource={resource} /></I18nProvider>)
        await Promise.resolve()
      })
      await flushTimers()
    }
    await render(sourceA)
    await click(container.querySelector<HTMLInputElement>('.draft-ai-toggle input')!)
    await click(buttonWithText(container, 'Modify parameters'))
    let form = container.querySelector<HTMLFormElement>('.draft-ai-composer')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(api.assistPlanForm).toHaveBeenCalledTimes(1)

    await render(sourceB)
    await click(buttonWithText(container, 'Modify parameters'))
    form = container.querySelector<HTMLFormElement>('.draft-ai-composer')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(api.assistPlanForm).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.draft-ai-thinking')).not.toBeNull()

    await act(async () => {
      first.resolve(aiEditResponse(888, 'STALE FIRST RESPONSE'))
      await Promise.resolve()
    })
    await flushTimers()
    expect(container.querySelector('.draft-ai-thinking')).not.toBeNull()
    expect(container.textContent).not.toContain('STALE FIRST RESPONSE')

    await act(async () => {
      second.resolve(aiEditResponse(222, 'CURRENT SECOND RESPONSE'))
      await Promise.resolve()
    })
    await flushTimers()
    expect(container.querySelector('.draft-ai-thinking')).toBeNull()
    expect(container.textContent).toContain('CURRENT SECOND RESPONSE')
  })

  it('populates localized quick prompts without submitting them', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const resource: ResourceNode = { id: 'resource-1', name: 'Case', type: 'Case', children: [] }
    const assist = vi.spyOn(api, 'assistPlanForm')
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-quick-prompts" parameters={baseline} project={project} resource={resource} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()

    await click(container.querySelector<HTMLInputElement>('.draft-ai-toggle input')!)
    const prompt = container.querySelector<HTMLTextAreaElement>('.draft-ai-composer textarea')!
    for (const [label, expected] of [
      ['Modify parameters', 'Modify the current Draft parameters.'],
      ['Fix validation', 'Make the current Draft pass Flow360 validation.'],
      ['Explain a parameter', 'without modifying any parameter values'],
    ]) {
      await click(buttonWithText(container, label))
      expect(prompt.value).toContain(expected)
    }
    expect(assist).not.toHaveBeenCalled()
  })

  it('records an explicit explanation without changing or revalidating the candidate', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const resource: ResourceNode = { id: 'resource-1', name: 'Case', type: 'Case', children: [] }
    const onCandidateChange = vi.fn()
    vi.spyOn(api, 'assistPlanForm').mockResolvedValue({
      mode: 'explain',
      explanation: 'Maximum steps limits the number of solver iterations. No values were changed.',
    })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-explain-submit" parameters={baseline} project={project} resource={resource} onCandidateChange={onCandidateChange} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()
    const validationCalls = vi.mocked(api.validateDraftParameters).mock.calls.length
    const candidateCalls = onCandidateChange.mock.calls.length

    await click(container.querySelector<HTMLButtonElement>('.schema-field-ai-explain')!)
    await act(async () => {
      container.querySelector<HTMLFormElement>('.draft-ai-composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flushTimers()

    expect(api.assistPlanForm).toHaveBeenCalledWith(expect.objectContaining({ mode: 'explain', autonomous: false }))
    expect(container.querySelector('.draft-ai-message.assistant')?.textContent).toContain('No values were changed.')
    expect(container.querySelector('.draft-ai-message-changes')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('.draft-parameter-save')?.disabled).toBe(true)
    expect(vi.mocked(api.validateDraftParameters).mock.calls.length).toBe(validationCalls)
    expect(onCandidateChange.mock.calls.length).toBe(candidateCalls)
    expect(api.updateDraftParameters).not.toHaveBeenCalled()
  })

  it('scopes explanation mode to one turn and edits the explained field only after a value is supplied', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const resource: ResourceNode = { id: 'resource-1', name: 'Geometry', type: 'Geometry', children: [] }
    vi.spyOn(api, 'assistPlanForm')
      .mockResolvedValueOnce({
        mode: 'explain',
        explanation: '`meshing.defaults.geometry_accuracy` controls how closely the mesh follows the CAD.',
      })
      .mockResolvedValueOnce({
        mode: 'edit',
        action: {
          version: 'v1', kind: 'request-missing-input', message: '请提供目标值。',
          questions: [{
            field: 'meshing.defaults.geometry_accuracy', message: '要设置为多少？',
            reason: '当前请求没有目标值。', urgency: 'required', type: 'number',
          }],
        },
      })
      .mockResolvedValueOnce({
        mode: 'edit',
        action: { version: 'v1', kind: 'update-draft', message: '已更新 Geometry Accuracy。', proposals: [] },
        proposal: {
          id: 'geometry-accuracy', action: 'Geometry', target: 'draft', name: 'Geometry Accuracy', intent: 'Set geometry accuracy',
          patch: { meshing: { defaults: { geometry_accuracy: 0.001 } } }, branch_preview: 'geometry-accuracy', fields: [],
        },
      })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-turn-mode" parameters={baseline} project={project} resource={resource} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()

    const explainAction = [...container.querySelectorAll<HTMLButtonElement>('.schema-field-ai-explain')]
      .find((button) => button.getAttribute('aria-label')?.includes('Geometry Accuracy'))
    if (!explainAction) throw new Error('Geometry Accuracy explanation action is unavailable')
    await click(explainAction)
    const form = container.querySelector<HTMLFormElement>('.draft-ai-composer')!
    const prompt = container.querySelector<HTMLTextAreaElement>('.draft-ai-composer textarea')!
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (!valueSetter) throw new Error('AI prompt textarea is unavailable')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flushTimers()
    expect(vi.mocked(api.assistPlanForm).mock.calls[0][0]).toEqual(expect.objectContaining({ mode: 'explain', autonomous: false }))

    await act(async () => {
      valueSetter.call(prompt, '帮我设置一下这个值')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flushTimers()
    expect(vi.mocked(api.assistPlanForm).mock.calls[1][0]).toEqual(expect.objectContaining({
      prompt: '帮我设置一下这个值', mode: 'edit', autonomous: false,
    }))
    expect(vi.mocked(api.assistPlanForm).mock.calls[1][0].history).toBeUndefined()
    expect(container.querySelector('.draft-ai-message.assistant')?.textContent).toContain('meshing.defaults.geometry_accuracy')
    expect(container.querySelector<HTMLButtonElement>('.draft-parameter-save')?.disabled).toBe(true)

    await act(async () => {
      valueSetter.call(prompt, '设置为 0.001 m')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flushTimers()
    expect(vi.mocked(api.assistPlanForm).mock.calls[2][0]).toEqual(expect.objectContaining({
      prompt: '设置为 0.001 m', mode: 'edit', autonomous: false,
    }))
    expect(container.querySelector('.draft-ai-message-changes')?.textContent).toContain('meshing.defaults.geometry_accuracy')
    expect(container.querySelector<HTMLButtonElement>('.draft-parameter-save')?.disabled).toBe(false)
  })

  it('keeps validation repair mutation-capable and marks the request autonomous', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const resource: ResourceNode = { id: 'resource-1', name: 'Case', type: 'Case', children: [] }
    vi.spyOn(api, 'assistPlanForm').mockResolvedValue({
      mode: 'repair',
      action: { version: 'v1', kind: 'update-draft', message: 'Repaired validation.', proposals: [] },
      proposal: {
        id: 'repair', action: 'Case', target: 'draft', name: 'Repair', intent: 'Pass validation',
        patch: { case: { solver: { max_steps: 200 } } }, branch_preview: 'repair', fields: [],
      },
      preflight: { valid: true, issues: [], schema_version: 1, form_schema: schema },
    })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-repair" parameters={baseline} project={project} resource={resource} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()

    await click(container.querySelector<HTMLInputElement>('.draft-ai-toggle input')!)
    await click(buttonWithText(container, 'Fix validation'))
    await act(async () => {
      container.querySelector<HTMLFormElement>('.draft-ai-composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flushTimers()

    expect(api.assistPlanForm).toHaveBeenCalledWith(expect.objectContaining({ mode: 'repair', autonomous: true }))
    expect(container.querySelector('.draft-ai-message-changes')?.textContent).toContain('case.solver.max_steps')
    expect(container.querySelector<HTMLButtonElement>('.draft-parameter-save')?.disabled).toBe(false)
  })

  it('renders request-missing-input as an assistant clarification and keeps the composer usable', async () => {
    const project: ProjectInfo = { id: 'project-1', name: 'Project', solver_version: '25.1', tags: [], root_item: { id: 'root', type: 'Folder' } }
    const resource: ResourceNode = { id: 'resource-1', name: 'Case', type: 'Case', children: [] }
    vi.spyOn(api, 'assistPlanForm').mockResolvedValue({
      action: {
        version: 'v1',
        kind: 'request-missing-input',
        message: 'I need more information before changing the Draft.',
        questions: [{
          field: 'case.solver.max_steps',
          message: 'Which maximum step count should I use?',
          reason: 'The request did not specify a value.',
          urgency: 'required',
          type: 'number',
          unit: 'steps',
          min: 1,
          max: 1000,
          placeholder: 'For example, 200',
          default: 100,
          options: [{ value: '100', label: 'Standard' }],
        }],
      },
    })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-clarification" parameters={baseline} project={project} resource={resource} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await flushTimers()

    await click(container.querySelector<HTMLInputElement>('.draft-ai-toggle input')!)
    const prompt = container.querySelector<HTMLTextAreaElement>('.draft-ai-composer textarea')!
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (!valueSetter) throw new Error('AI prompt textarea is unavailable')
    await act(async () => {
      valueSetter.call(prompt, 'Set the solver steps')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector<HTMLFormElement>('.draft-ai-composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flushTimers()

    const assistant = container.querySelector<HTMLElement>('.draft-ai-message.assistant')
    expect(assistant?.textContent).toContain('I need more information before changing the Draft.')
    expect(assistant?.textContent).toContain('case.solver.max_steps')
    expect(assistant?.textContent).toContain('The request did not specify a value.')
    expect(assistant?.textContent).toContain('required')
    expect(assistant?.textContent).toContain('number')
    expect(assistant?.textContent).toContain('steps')
    expect(assistant?.textContent).toContain('1')
    expect(assistant?.textContent).toContain('1000')
    expect(assistant?.textContent).toContain('For example, 200')
    expect(assistant?.textContent).toContain('Standard (100)')
    expect(container.querySelector('.draft-ai-message.error')).toBeNull()
    expect(prompt.disabled).toBe(false)
    expect(api.assistPlanForm).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Set the solver steps',
      mode: 'edit',
      autonomous: false,
    }))
    expect(vi.mocked(api.assistPlanForm).mock.calls[0][0].history).toBeUndefined()

    await act(async () => {
      valueSetter.call(prompt, 'Use the suggested value')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector<HTMLFormElement>('.draft-ai-composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flushTimers()
    expect(api.assistPlanForm).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.assistPlanForm).mock.calls[1][0].history).toBeUndefined()
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
    const validationsBeforeBrowsing = vi.mocked(api.validateDraftParameters).mock.calls.length

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
    await click(buttonWithText(container, 'Preview'))
    await click(buttonWithText(container, 'Return to edit'))
    expect(vi.mocked(api.validateDraftParameters).mock.calls.length).toBe(validationsBeforeBrowsing)
  })

  it('searches and groups type choices, then provides long-form anchors and filtering', async () => {
    const outputVariant = (title: string): DynamicFormSchema => ({
      type: 'object',
      title,
      required: ['entities'],
      properties: {
        entities: { type: 'entity_list', title: 'Entities', required: true, entity_kind: 'Surface', entity_choices: [] },
        name: { type: 'string', title: 'Name' },
        fields: { type: 'multi_select', title: 'Output fields', value_key: 'items', options: ['Cp'] },
        frequency: { type: 'integer', title: 'Frequency' },
        format: { type: 'enum', title: 'Format', options: ['paraview'] },
        notes: { type: 'string', title: 'Notes' },
      },
    })
    const outputSchema: DynamicFormSchema = {
      type: 'object',
      properties: {
        outputs: {
          type: 'array', title: 'Outputs', items: { type: 'union', variants: [outputVariant('SurfaceOutput'), outputVariant('ForceOutput')] },
        },
      },
    }
    vi.mocked(api.draftParameterSchema).mockResolvedValueOnce({
      schema_version: 1, source_type: 'Case', stages: ['Case'], schema: outputSchema, baseline: { outputs: [] },
    })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-long-form" parameters={{ outputs: [] }} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await click(buttonWithText(container, 'Add item'))

    const search = document.body.querySelector<HTMLInputElement>('.schema-array-type-search input')
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!search || !valueSetter) throw new Error('Type search is unavailable')
    expect(search.placeholder).toBe('Search types')
    expect(search.closest('label')?.querySelectorAll('.sr-only')).toHaveLength(1)
    expect(document.body.querySelector('.schema-array-type-menu')?.textContent).toContain('Surface')
    expect(document.body.querySelector('.schema-array-type-menu')?.textContent).toContain('Force')
    await act(async () => {
      valueSetter.call(search, 'force')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const menu = document.body.querySelector<HTMLElement>('.schema-array-type-menu')!
    expect(menu.textContent).toContain('Force Output')
    expect(menu.textContent).not.toContain('Surface Output')
    await click(buttonWithText(menu, 'Force Output'))

    const dialog = document.body.querySelector<HTMLElement>('.schema-item-editor-dialog')!
    expect(dialog.querySelector('.schema-item-editor-nav')).not.toBeNull()
    expect(dialog.textContent).toContain('Required / errors only')
    expect(dialog.querySelector('#schema-outputs-0-notes')).not.toBeNull()
    await click(buttonWithText(dialog, 'Required / errors only'))
    expect(dialog.querySelector('#schema-outputs-0-entities')).not.toBeNull()
    expect(dialog.querySelector('#schema-outputs-0-notes')).toBeNull()
    expect(dialog.querySelector('.schema-item-editor-nav')?.textContent).not.toContain('Other fields')
  })

  it('gives a short item editor the full no-navigation workspace', async () => {
    const shortSchema: DynamicFormSchema = {
      type: 'object',
      properties: {
        outputs: {
          type: 'array', title: 'Outputs', items: {
            type: 'object', title: 'MeshSliceOutput',
            properties: {
              name: { type: 'string', title: 'Name' },
              origin: { type: 'quantity', title: 'Origin', unit: 'm', unit_options: ['m'], value_schema: { type: 'number' } },
              normal: { type: 'string', title: 'Normal' },
            },
          },
        },
      },
    }
    vi.mocked(api.draftParameterSchema).mockResolvedValueOnce({
      schema_version: 1, source_type: 'Case', stages: ['Case'], schema: shortSchema,
      baseline: { outputs: [{ name: 'slice', origin: { value: 0, units: 'm' }, normal: 'x' }] },
    })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-no-nav" parameters={{ outputs: [{ name: 'slice' }] }} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()
    await click(buttonWithText(container, 'Edit'))

    const dialog = document.body.querySelector<HTMLElement>('.schema-item-editor-dialog')!
    const workspace = dialog.querySelector<HTMLElement>('.schema-item-editor-workspace')!
    expect(workspace.classList.contains('no-nav')).toBe(true)
    expect(workspace.classList.contains('has-nav')).toBe(false)
    expect(dialog.querySelector('.schema-item-editor-nav')).toBeNull()
    expect(workspace.firstElementChild).toBe(dialog.querySelector('.schema-item-editor-body'))
  })

  it('keeps portal type selection and its nested editor inside a complete keyboard focus flow', async () => {
    const outputVariant = (title: string): DynamicFormSchema => ({
      type: 'object',
      title,
      properties: {
        name: { type: 'string', title: 'Name' },
        frequency: { type: 'integer', title: 'Frequency' },
        format: { type: 'enum', title: 'Format', options: ['paraview'] },
        notes: { type: 'string', title: 'Notes' },
        enabled: { type: 'boolean', title: 'Enabled' },
        mode: {
          type: 'union', title: 'Mode', variants: [
            { type: 'string', title: 'Automatic', description: 'Use automatic mode.' },
            { type: 'string', title: 'Manual', description: 'Use manual mode.' },
          ],
        },
      },
    })
    const outputSchema: DynamicFormSchema = {
      type: 'object',
      properties: {
        outputs: {
          type: 'array', title: 'Outputs', items: { type: 'union', variants: [outputVariant('SurfaceOutput'), outputVariant('ForceOutput')] },
        },
      },
    }
    vi.mocked(api.draftParameterSchema).mockResolvedValueOnce({
      schema_version: 1, source_type: 'Case', stages: ['Case'], schema: outputSchema, baseline: { outputs: [] },
    })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-keyboard" parameters={{ outputs: [] }} /></I18nProvider>)
      await Promise.resolve()
    })
    await flushTimers()

    const add = buttonWithText(container, 'Add item') as HTMLButtonElement
    add.focus()
    await click(add)
    const menu = document.body.querySelector<HTMLElement>('.schema-array-type-menu')!
    const search = menu.querySelector<HTMLInputElement>('input')!
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(document.activeElement).toBe(search)
    await press(search, 'ArrowDown')
    expect(document.activeElement).toBe(items[0])
    await press(items[0], 'End')
    expect(document.activeElement).toBe(items[1])
    await press(items[1], 'Home')
    expect(document.activeElement).toBe(items[0])
    await press(items[0], 'ArrowUp')
    expect(document.activeElement).toBe(items[1])
    await press(items[1], 'Enter')

    const dialog = document.body.querySelector<HTMLElement>('.schema-item-editor-dialog')!
    const close = dialog.querySelector<HTMLButtonElement>('.schema-item-editor-close')!
    const save = dialog.querySelector<HTMLButtonElement>('footer .primary')!
    expect(document.activeElement).toBe(close)
    save.focus()
    await press(save, 'Tab')
    expect(document.activeElement).toBe(close)
    await press(close, 'Tab', true)
    expect(document.activeElement).toBe(save)

    const help = dialog.querySelector<HTMLButtonElement>('.schema-union-option-help button')!
    await act(async () => help.focus())
    expect(document.body.querySelector('.help-tooltip__content--portal.is-visible')).not.toBeNull()
    await press(help, 'Escape')
    expect(document.body.querySelector('.schema-item-editor-dialog')).toBe(dialog)
    expect(document.body.querySelector('.help-tooltip__content--portal.is-visible')).toBeNull()
    expect(document.activeElement).toBe(help)
    await press(help, 'Escape')
    expect(document.body.querySelector('.schema-item-editor-dialog')).toBeNull()
    expect(document.activeElement).toBe(add)

    await click(add)
    const reopenedMenu = document.body.querySelector<HTMLElement>('.schema-array-type-menu')!
    await press(reopenedMenu.querySelector('input')!, 'Escape')
    expect(document.body.querySelector('.schema-array-type-menu')).toBeNull()
    expect(document.activeElement).toBe(add)

    await click(add)
    const finalMenu = document.body.querySelector<HTMLElement>('.schema-array-type-menu')!
    await press(finalMenu.querySelector('input')!, 'ArrowDown')
    await press(document.activeElement!, 'Enter')
    const finalDialog = document.body.querySelector<HTMLElement>('.schema-item-editor-dialog')!
    await click(finalDialog.querySelector<HTMLButtonElement>('footer .primary')!)
    const edit = buttonWithText(container, 'Edit') as HTMLButtonElement
    edit.focus()
    await click(edit)
    const editDialog = document.body.querySelector<HTMLElement>('.schema-item-editor-dialog')!
    await click(buttonWithText(editDialog, 'Cancel'))
    expect(document.activeElement).toBe(edit)
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
    await click(buttonWithText(container, 'Validate'))
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

  it('dismisses the local changes notice when clicking outside the status popover', async () => {
    vi.mocked(api.validateDraftParameters).mockResolvedValue({ schema_version: 1, valid: true, issues: [] })
    await act(async () => {
      root.render(<I18nProvider><DraftParameterEditor draftId="draft-unsaved-popover" parameters={baseline} /></I18nProvider>)
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

    const popover = container.querySelector<HTMLDetailsElement>('.draft-validation-popover')
    expect(popover).not.toBeNull()
    expect(container.textContent).toContain('Unsaved local changes')
    await act(async () => {
      popover!.open = true
    })
    expect(popover!.open).toBe(true)

    await click(document.body)

    expect(popover!.open).toBe(false)
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
