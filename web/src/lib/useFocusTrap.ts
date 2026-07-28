import { useEffect, useRef } from 'react'

/**
 * Trap keyboard focus inside an element while it's open and restore focus
 * to the previously focused element on close. Escape invokes `onClose`.
 *
 * Uses query-based focusable element discovery so callers don't have to
 * wire refs for every button/input inside the dialog. Safe to call on an
 * element that contains no focusable children — it just becomes inert.
 */
export function useFocusTrap<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  autoFocusSelector?: string,
): React.RefObject<T | null> {
  const scopeRef = useRef<T | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const scope = scopeRef.current
    if (!scope) return

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null

    const focusableSelector = [
      'a[href]',
      'area[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const getFocusable = () => {
      const nodes = scope.querySelectorAll<HTMLElement>(focusableSelector)
      return Array.from(nodes).filter(
        (node) => !node.hasAttribute('disabled') && node.getAttribute('tabindex') !== '-1',
      )
    }

    const focusTarget = (autoFocusSelector
      ? scope.querySelector<HTMLElement>(autoFocusSelector)
      : null) ?? getFocusable()[0] ?? scope
    const frame = requestAnimationFrame(() => {
      focusTarget?.focus()
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    scope.addEventListener('keydown', onKeyDown)

    return () => {
      cancelAnimationFrame(frame)
      scope.removeEventListener('keydown', onKeyDown)
      const previous = previouslyFocusedRef.current
      if (previous && 'focus' in previous) previous.focus()
    }
  }, [open, onClose, autoFocusSelector])

  return scopeRef
}
