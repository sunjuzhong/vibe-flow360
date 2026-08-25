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
    const buttons = container.querySelectorAll<HTMLElement>('[role="radio"]')
    buttons[0].focus()
    await act(async () => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(document.activeElement).toBe(buttons[1])
    await act(async () => buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onSelect).toHaveBeenLastCalledWith(1)
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
    expect(container.querySelector<HTMLElement>('[role="radio"]')?.getAttribute('aria-disabled')).toBe('true')
    expect(container.querySelector<HTMLElement>('[role="radio"]')?.tabIndex).toBe(-1)
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('keeps help triggers outside radios while preserving the tooltip keyboard path', async () => {
    await act(async () => {
      root.render(<UnionVariantPicker
        title="Heat Spec"
        variants={[{ type: 'object', title: 'HeatFlux', description: 'Controls the wall heat flux.' }]}
        selected={0}
        onSelect={() => undefined}
      />)
    })
    const radio = container.querySelector<HTMLElement>('[role="radio"]')!
    const help = container.querySelector<HTMLButtonElement>('.schema-union-option-help button')!
    const helpContainer = help.closest('.schema-union-option-help')!
    expect(help.closest('[role="radio"]')).toBeNull()
    expect(helpContainer.parentElement).toBe(radio.parentElement)
    expect(radio.nextElementSibling).toBe(helpContainer)
    expect(help.tabIndex).toBe(0)

    radio.focus()
    expect(document.activeElement).toBe(radio)
    await act(async () => help.focus())
    expect(document.activeElement).toBe(help)
    expect(document.body.querySelector('.help-tooltip__content--portal.is-visible')).not.toBeNull()

    await act(async () => help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.body.querySelector('.help-tooltip__content--portal.is-visible')).toBeNull()
  })
})
