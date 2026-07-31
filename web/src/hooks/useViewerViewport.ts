import { useEffect, useRef, type RefObject } from 'react'
import type * as THREE from 'three'
import { resizePerspectiveViewport } from '../lib/viewerCamera'

export function useViewerViewport({
  containerRef,
  rendererRef,
  cameraRef,
  onResize,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  rendererRef: RefObject<THREE.WebGLRenderer | null>
  cameraRef: RefObject<THREE.PerspectiveCamera | null>
  onResize?: (size: { width: number; height: number }) => void
}) {
  const onResizeRef = useRef(onResize)

  useEffect(() => {
    onResizeRef.current = onResize
  }, [onResize])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame: number | null = null
    let lastWidth = 0
    let lastHeight = 0

    const applySize = () => {
      frame = null
      const width = Math.round(container.clientWidth)
      const height = Math.round(container.clientHeight)
      if (width <= 0 || height <= 0 || (width === lastWidth && height === lastHeight)) return
      lastWidth = width
      lastHeight = height
      const camera = cameraRef.current
      const renderer = rendererRef.current
      if (camera && renderer) resizePerspectiveViewport(renderer, camera, width, height)
      onResizeRef.current?.({ width, height })
    }
    const scheduleResize = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(applySize)
    }
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleResize)
    observer?.observe(container)
    window.addEventListener('resize', scheduleResize)
    window.addEventListener('orientationchange', scheduleResize)
    scheduleResize()

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', scheduleResize)
      window.removeEventListener('orientationchange', scheduleResize)
    }
  }, [cameraRef, containerRef, rendererRef])
}
