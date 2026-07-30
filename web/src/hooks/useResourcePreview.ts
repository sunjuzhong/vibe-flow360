import { useCallback, useEffect, useRef, useState } from 'react'
import type { ViewerManifest, ViewerState } from '../components/viewer/LazyViewer3D'

export function useResourcePreview(
  resourceType: string | null,
  resourceId: string | null,
  fallbackType: string | null = null,
  fallbackId: string | null = null,
) {
  const [manifest, setManifest] = useState<ViewerManifest | null>(null)
  const [state, setState] = useState<ViewerState>({ status: 'idle' })
  const [source, setSource] = useState<'primary' | 'fallback' | null>(null)
  const [primaryError, setPrimaryError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (
    type: string,
    id: string,
    alternateType: string | null,
    alternateId: string | null,
  ) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'loading', progress: 0 })
    setSource(null)
    setPrimaryError('')

    const fetchManifest = async (previewType: string, previewId: string) => {
      const url = `/api/flow360/resources/${encodeURIComponent(previewType)}/${encodeURIComponent(previewId)}/preview-mesh`
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Preview unavailable (HTTP ${response.status})`)
      }
      return response.json() as Promise<ViewerManifest>
    }

    try {
      const data = await fetchManifest(type, id)
      setManifest(data)
      setSource('primary')
      setState({ status: 'ready' })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      setPrimaryError(message)
      if (alternateType && alternateId && (alternateType !== type || alternateId !== id)) {
        try {
          const fallback = await fetchManifest(alternateType, alternateId)
          setManifest({
            ...fallback,
            warnings: [
              `${type} visualization is not exposed by the current Flow360 CLI snapshot. Showing ${alternateType} as spatial context.`,
              ...(fallback.warnings ?? []),
            ],
          })
          setSource('fallback')
          setState({ status: 'ready' })
          return
        } catch (fallbackError) {
          if ((fallbackError as Error).name === 'AbortError') return
        }
      }
      setManifest(null)
      setSource(null)
      setState({ status: 'error', message })
    }
  }, [])

  useEffect(() => {
    if (!resourceType || !resourceId) {
      abortRef.current?.abort()
      setManifest(null)
      setSource(null)
      setPrimaryError('')
      setState({ status: 'idle' })
      return
    }
    load(resourceType, resourceId, fallbackType, fallbackId)
    return () => {
      abortRef.current?.abort()
    }
  }, [resourceType, resourceId, fallbackType, fallbackId, load])

  return {
    manifest,
    state,
    source,
    primaryError,
    refetch: () => resourceType && resourceId && load(resourceType, resourceId, fallbackType, fallbackId),
  }
}
