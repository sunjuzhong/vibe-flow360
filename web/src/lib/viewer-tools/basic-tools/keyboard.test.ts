import { describe, expect, it } from 'vitest'
import { isEditableKeyboardTarget, openToolKeyboardCommand } from './keyboard'

function event(key: string, target: object | null = null) {
  return { key, target: target as EventTarget | null }
}

describe('open tool keyboard commands', () => {
  it('maps Enter, Backspace, and Escape to shared runtime actions', () => {
    expect(openToolKeyboardCommand(event('Enter'))).toBe('finish')
    expect(openToolKeyboardCommand(event('Backspace'))).toBe('undo-last')
    expect(openToolKeyboardCommand(event('Escape'))).toBe('cancel')
    expect(openToolKeyboardCommand(event('Space'))).toBeNull()
  })

  it.each(['input', 'TEXTAREA', 'Select'])('ignores keys from %s controls', (tagName) => {
    expect(isEditableKeyboardTarget({ tagName } as unknown as EventTarget)).toBe(true)
    expect(openToolKeyboardCommand(event('Enter', { tagName }))).toBeNull()
    expect(openToolKeyboardCommand(event('Backspace', { nodeName: tagName }))).toBeNull()
  })

  it('ignores contentEditable targets', () => {
    expect(openToolKeyboardCommand(event('Escape', { isContentEditable: true }))).toBeNull()
    expect(openToolKeyboardCommand(event('Enter', { contentEditable: 'true' }))).toBeNull()
  })
})
