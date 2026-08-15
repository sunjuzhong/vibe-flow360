import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

export const MANIFEST_ROW_HEIGHT = 36
const MANIFEST_ROW_OVERSCAN = 8

export function virtualManifestRowWindow(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  listTop: number,
  rowHeight = MANIFEST_ROW_HEIGHT,
  overscan = MANIFEST_ROW_OVERSCAN,
) {
  const localTop = Math.max(0, scrollTop - listTop)
  const start = Math.min(itemCount, Math.max(0, Math.floor(localTop / rowHeight) - overscan))
  const visibleCount = Math.ceil(Math.max(viewportHeight, rowHeight) / rowHeight)
  const end = Math.min(itemCount, start + visibleCount + overscan * 2)
  return { start, end }
}

export function VirtualizedManifestRows<T>({
  items,
  scrollContainerRef,
  renderRow,
}: {
  items: readonly T[]
  scrollContainerRef: RefObject<HTMLElement | null>
  renderRow: (item: T, index: number) => ReactNode
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [window, setWindow] = useState(() => ({ start: 0, end: Math.min(items.length, 40) }))

  const updateWindow = useCallback(() => {
    const container = scrollContainerRef.current
    const list = listRef.current
    if (!container || !list) return
    const containerRect = container.getBoundingClientRect()
    const listTop = list.getBoundingClientRect().top - containerRect.top + container.scrollTop
    const next = virtualManifestRowWindow(
      items.length,
      container.scrollTop,
      container.clientHeight,
      listTop,
    )
    setWindow((current) => current.start === next.start && current.end === next.end ? current : next)
  }, [items.length, scrollContainerRef])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    updateWindow()
    const frame = requestAnimationFrame(updateWindow)
    const observer = new ResizeObserver(updateWindow)
    observer.observe(container)
    container.addEventListener('scroll', updateWindow, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      container.removeEventListener('scroll', updateWindow)
    }
  }, [scrollContainerRef, updateWindow])

  return (
    <div
      ref={listRef}
      className="virtualized-manifest-rows"
      style={{ height: items.length * MANIFEST_ROW_HEIGHT }}
    >
      {items.slice(window.start, window.end).map((item, offset) => {
        const index = window.start + offset
        return (
          <div
            className="virtualized-manifest-row"
            key={index}
            style={{ height: MANIFEST_ROW_HEIGHT, transform: `translateY(${index * MANIFEST_ROW_HEIGHT}px)` }}
          >
            {renderRow(item, index)}
          </div>
        )
      })}
    </div>
  )
}
