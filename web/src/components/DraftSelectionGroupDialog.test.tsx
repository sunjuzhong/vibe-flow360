/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { DraftSelectionGroupDialog } from './DraftSelectionGroupDialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function renderDialog(props: Parameters<typeof DraftSelectionGroupDialog>[0]) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<I18nProvider><DraftSelectionGroupDialog {...props} /></I18nProvider>))
  return { container, root }
}

describe('DraftSelectionGroupDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('shows the empty selection state and prevents saving', async () => {
    const onSave = vi.fn(async () => undefined)
    const { root } = await renderDialog({ faceCount: 0, edgeCount: 0, onSave, onClose: vi.fn() })
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('Select at least one face or edge')
    expect([...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Save to Draft'))?.disabled).toBe(true)
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('requires a name, submits the trimmed name, and closes after a successful save', async () => {
    const onSave = vi.fn(async () => undefined)
    const onClose = vi.fn()
    const { root } = await renderDialog({ faceCount: 2, edgeCount: 1, onSave, onClose })
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const form = dialog.querySelector('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(dialog.textContent).toContain('Selection group name is required')

    const input = dialog.querySelector<HTMLInputElement>('input')!
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      valueSetter?.call(input, '  control surfaces  ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(onSave).toHaveBeenCalledWith('control surfaces')
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('keeps the form open and reports a save failure', async () => {
    const onClose = vi.fn()
    const { root } = await renderDialog({
      faceCount: 1,
      edgeCount: 0,
      onSave: vi.fn(async () => { throw new Error('A selection group named “Wing” already exists.') }),
      onClose,
    })
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const input = dialog.querySelector<HTMLInputElement>('input')!
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      valueSetter?.call(input, 'Wing')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => dialog.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(dialog.textContent).toContain('already exists')
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})
