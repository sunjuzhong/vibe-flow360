export type OpenToolKeyboardCommand = 'finish' | 'undo-last' | 'cancel'

type KeyboardTarget = {
  readonly tagName?: string
  readonly nodeName?: string
  readonly isContentEditable?: boolean
  readonly contentEditable?: string
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const candidate = target as KeyboardTarget
  const tagName = (candidate.tagName ?? candidate.nodeName ?? '').toUpperCase()
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
    || candidate.isContentEditable === true || candidate.contentEditable === 'true'
}

export function openToolKeyboardCommand(
  event: Pick<KeyboardEvent, 'key' | 'target'>,
): OpenToolKeyboardCommand | null {
  if (isEditableKeyboardTarget(event.target)) return null
  if (event.key === 'Enter') return 'finish'
  if (event.key === 'Backspace') return 'undo-last'
  if (event.key === 'Escape') return 'cancel'
  return null
}
