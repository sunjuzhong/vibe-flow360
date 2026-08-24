/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UnionVariantPicker from './UnionVariantPicker'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('UnionVariantPicker keyboard contract', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('moves the radio selection and focus with arrow keys', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(<UnionVariantPicker
        title="Output type"
        variants={[{ type: 'string', title: 'Text' }, { type: 'number', title: 'Number' }]}
        selected={0}
        onSelect={onSelect}
      />)
    })
    const buttons = container.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    buttons[0].focus()
    await act(async () => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(document.activeElement).toBe(buttons[1])
  })

  it('removes disabled variants from keyboard interaction', async () => {
    await act(async () => {
      root.render(<UnionVariantPicker
        title="Output type"
        variants={[{ type: 'string', title: 'Text' }]}
        selected={0}
        disabled
        onSelect={() => undefined}
      />)
    })
    expect(container.querySelector<HTMLButtonElement>('[role="radio"]')?.disabled).toBe(true)
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute('aria-disabled')).toBe('true')
  })
})

