import { CircleHelp } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  children: ReactNode
  label?: string
  placement?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
  width?: 'default' | 'wide' | 'guide'
}

type Rect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>
const HELP_TOOLTIP_OPEN_EVENT = 'flow360-help-tooltip-open'

export function placeTooltip(
  trigger: Rect,
  tooltip: Pick<Rect, 'width' | 'height'>,
  viewport: { width: number; height: number; left?: number; top?: number },
  placement: 'top' | 'bottom',
  align: 'start' | 'center' | 'end',
) {
  const margin = 12
  const gap = 7
  const viewportLeft = viewport.left ?? 0
  const viewportTop = viewport.top ?? 0
  const viewportRight = viewportLeft + viewport.width
  const viewportBottom = viewportTop + viewport.height
  const alignedLeft = align === 'start'
    ? trigger.left
    : align === 'end'
      ? trigger.right - tooltip.width
      : trigger.left + (trigger.width - tooltip.width) / 2
  const left = Math.min(
    Math.max(alignedLeft, viewportLeft + margin),
    Math.max(viewportLeft + margin, viewportRight - tooltip.width - margin),
  )
  const above = trigger.top - tooltip.height - gap
  const below = trigger.bottom + gap
  const preferredTop = placement === 'top' ? above : below
  const alternateTop = placement === 'top' ? below : above
  const preferredFits = preferredTop >= viewportTop + margin && preferredTop + tooltip.height <= viewportBottom - margin
  const alternateFits = alternateTop >= viewportTop + margin && alternateTop + tooltip.height <= viewportBottom - margin
  const candidateTop = preferredFits || !alternateFits ? preferredTop : alternateTop
  const top = Math.min(
    Math.max(candidateTop, viewportTop + margin),
    Math.max(viewportTop + margin, viewportBottom - tooltip.height - margin),
  )
  return { left, top }
}

export default function HelpTooltip({
  children,
  label = 'Show help',
  placement = 'bottom',
  align = 'center',
  width = 'default',
}: Props) {
  const tooltipId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [draftContext, setDraftContext] = useState(false)
  const portal = mounted && width !== 'guide'

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    const closeForAnotherTooltip = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== tooltipId) setOpen(false)
    }
    document.addEventListener(HELP_TOOLTIP_OPEN_EVENT, closeForAnotherTooltip)
    return () => document.removeEventListener(HELP_TOOLTIP_OPEN_EVENT, closeForAnotherTooltip)
  }, [tooltipId])
  useLayoutEffect(() => {
    if (mounted) setDraftContext(Boolean(triggerRef.current?.closest('.draft-parameter-form')))
  }, [mounted])

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const content = contentRef.current
    if (!trigger || !content) return
    const contentRect = content.getBoundingClientRect()
    const viewport = window.visualViewport
    setPosition(placeTooltip(
      trigger.getBoundingClientRect(),
      contentRect,
      {
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
      },
      placement,
      align,
    ))
  }, [align, placement])

  useLayoutEffect(() => {
    if (!portal || !open) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.visualViewport?.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('scroll', updatePosition)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.visualViewport?.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('scroll', updatePosition)
    }
  }, [open, portal, updatePosition])

  const show = () => {
    document.dispatchEvent(new CustomEvent(HELP_TOOLTIP_OPEN_EVENT, { detail: tooltipId }))
    setPosition(null)
    setOpen(true)
  }
  const hide = () => setOpen(false)
  const content = (
    <span
      ref={contentRef}
      className={`help-tooltip__content${portal ? ` help-tooltip__content--portal help-tooltip__content--portal-${width}${draftContext ? ' help-tooltip__content--portal-draft' : ''}` : ''}${portal && open && position ? ' is-visible' : ''}`}
      id={tooltipId}
      role="tooltip"
      style={portal && position ? { left: position.left, top: position.top } : undefined}
    >
      {children}
    </span>
  )

  return (
    <span
      className={`help-tooltip help-tooltip--${placement} help-tooltip--${align} help-tooltip--${width}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="help-tooltip__trigger"
        aria-label={label}
        aria-describedby={tooltipId}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <CircleHelp size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {portal ? createPortal(content, document.body) : content}
    </span>
  )
}
