import { useState, useCallback, useEffect, useRef } from 'react'

export interface ConvergenceMetric {
  name: string
  final: number
  min: number
  max: number
  mean: number
  delta: number
  stable: boolean
  trend: string
  oscillating: boolean
}

export interface ConvergenceAssessment {
  status: string
  reason: string
  metrics: Record<string, ConvergenceMetric>
  window_size: number
  threshold: number
  algorithm_version: string
  warnings?: string[]
}

export interface ConvergenceResult {
  status: string
  reason: string
  files: Array<{ path: string; type: string; size?: number }>
  assessments: Record<string, ConvergenceAssessment>
}

export function useConvergenceAssessment(resourceId: string | null) {
  const [result, setResult] = useState<ConvergenceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (id: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)

    try {
      const resp = await fetch(`/api/flow360/resources/Case/${encodeURIComponent(id)}/convergence`, {
        signal: ctrl.signal,
      })
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`)
      }
      const data = await resp.json() as ConvergenceResult
      setResult(data)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (resourceId) {
      load(resourceId)
    } else {
      setResult(null)
      setError(null)
    }
  }, [resourceId, load])

  return {
    result,
    loading,
    error,
    refetch: () => resourceId && load(resourceId),
  }
}
