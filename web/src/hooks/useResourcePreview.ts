import { useCallback, useEffect, useRef, useState } from 'react'
import type { ViewerManifest, ViewerState } from '../components/viewer/Viewer3D'

export function useResourcePreview(resourceType: string | null, resourceId: string | null) {
  const [manifest, setManifest] = useState<ViewerManifest | null>(null)
  const [state, setState] = useState<ViewerState>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (type: string, id: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'loading', progress: 0 })

    try {
      const url = `/api/flow360/resources/${encodeURIComponent(type)}/${encodeURIComponent(id)}/preview-mesh`
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Preview unavailable (HTTP ${response.status})`)
      }
      const data = await response.json() as ViewerManifest
      setManifest(data)
      setState({ status: 'ready' })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      setManifest(null)
      setState({ status: 'error', message })
    }
  }, [])

  useEffect(() => {
    if (!resourceType || !resourceId) {
      abortRef.current?.abort()
      setManifest(null)
      setState({ status: 'idle' })
      return
    }
    load(resourceType, resourceId)
    return () => {
      abortRef.current?.abort()
    }
  }, [resourceType, resourceId, load])

  return { manifest, state, refetch: () => resourceType && resourceId && load(resourceType, resourceId) }
}
