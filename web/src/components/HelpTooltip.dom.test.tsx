/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HelpTooltip from './HelpTooltip'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('HelpTooltip browser interactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.querySelectorAll('.help-tooltip__content--portal').forEach((node) => node.remove())
  })

  it('keeps one described tooltip visible, repositions on scroll, and closes with Escape', async () => {
    await act(async () => {
      root.render(<><HelpTooltip label="About Domain Type">Domain type guidance</HelpTooltip><HelpTooltip label="About Relative Size">Relative size guidance</HelpTooltip></>)
    })
    const triggers = [...container.querySelectorAll<HTMLButtonElement>('.help-tooltip__trigger')]
    let top = 120
    triggers[0].getBoundingClientRect = () => ({ top, bottom: top + 24, left: 100, right: 124, width: 24, height: 24, x: 100, y: top, toJSON: () => ({}) }) as DOMRect
    triggers[1].getBoundingClientRect = () => ({ top: 180, bottom: 204, left: 150, right: 174, width: 24, height: 24, x: 150, y: 180, toJSON: () => ({}) }) as DOMRect
    document.body.querySelectorAll<HTMLElement>('.help-tooltip__content--portal').forEach((content) => {
      content.getBoundingClientRect = () => ({ top: 0, bottom: 50, left: 0, right: 180, width: 180, height: 50, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })

    await act(async () => triggers[0].focus())
    let visible = document.body.querySelector<HTMLElement>('.help-tooltip__content--portal.is-visible')!
    expect(visible.textContent).toBe('Domain type guidance')
    expect(triggers[0].getAttribute('aria-describedby')).toBe(visible.id)
    const firstTop = visible.style.top

    top = 220
    await act(async () => window.dispatchEvent(new Event('scroll')))
    visible = document.body.querySelector<HTMLElement>('.help-tooltip__content--portal.is-visible')!
    expect(visible.style.top).not.toBe(firstTop)

    await act(async () => triggers[1].focus())
    visible = document.body.querySelector<HTMLElement>('.help-tooltip__content--portal.is-visible')!
    expect(visible.textContent).toBe('Relative size guidance')
    expect(document.body.querySelectorAll('.help-tooltip__content--portal.is-visible')).toHaveLength(1)

    await act(async () => triggers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.body.querySelector('.help-tooltip__content--portal.is-visible')).toBeNull()
  })
})
