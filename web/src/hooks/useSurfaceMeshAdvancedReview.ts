import { useEffect, useMemo, useReducer } from 'react'
import { api, type ProjectItem, type ResourceDetail } from '../api/client'
import type { ViewerManifest } from '../components/viewer/LazyViewer3D'
import {
  UVFLoader,
  createFieldHistogram,
  type UVFFieldHistogram,
} from '../lib/uvf-three'
import {
  compareSurfaceParameters,
  surfaceComparisonParameters,
  type SurfaceParameterDifference,
} from '../lib/surfaceMeshAdvanced'

type Comparison = {
  resource: ProjectItem
  detail: ResourceDetail
  parameterDifferences: SurfaceParameterDifference[]
  histogram: UVFFieldHistogram | null
  qualityError?: string
}

type State = {
  compareId: string
  comparison: Comparison | null
  comparisonLoading: boolean
  comparisonError: string
  captureRequest: number
  remediationBusy: boolean
  remediationError: string
}

type Action =
  | { type: 'compare-id'; id: string }
  | { type: 'comparison-loading' }
  | { type: 'comparison-ready'; comparison: Comparison }
  | { type: 'comparison-error'; error: string }
  | { type: 'capture' }
  | { type: 'remediation-start' }
  | { type: 'remediation-done' }
  | { type: 'remediation-error'; error: string }

const initialState: State = {
  compareId: '',
  comparison: null,
  comparisonLoading: false,
  comparisonError: '',
  captureRequest: 0,
  remediationBusy: false,
  remediationError: '',
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'compare-id':
      return { ...state, compareId: action.id, comparison: null, comparisonError: '' }
    case 'comparison-loading':
      return { ...state, comparisonLoading: true, comparisonError: '' }
    case 'comparison-ready':
      return { ...state, comparisonLoading: false, comparison: action.comparison }
    case 'comparison-error':
      return { ...state, comparisonLoading: false, comparison: null, comparisonError: action.error }
    case 'capture':
      return { ...state, captureRequest: state.captureRequest + 1 }
    case 'remediation-start':
      return { ...state, remediationBusy: true, remediationError: '' }
    case 'remediation-done':
      return { ...state, remediationBusy: false }
    case 'remediation-error':
      return { ...state, remediationBusy: false, remediationError: action.error }
  }
}

export function useSurfaceMeshAdvancedReview({
  versions,
  currentId,
  currentDetail,
  selectedField,
}: {
  versions: ProjectItem[]
  currentId: string
  currentDetail: ResourceDetail | null
  selectedField: string | null
}) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const comparisonVersions = useMemo(
    () => versions.filter((version) => version.id !== currentId),
    [currentId, versions],
  )
  useEffect(() => {
    if (!state.compareId) return
    const resource = comparisonVersions.find((version) => version.id === state.compareId)
    if (!resource) return
    const controller = new AbortController()
    dispatch({ type: 'comparison-loading' })
    void (async () => {
      try {
        const detailResponse = await api.resourceDetail('SurfaceMesh', resource.id)
        const detail = detailResponse.data
        let histogram: UVFFieldHistogram | null = null
        let qualityError: string | undefined
        if (selectedField) {
          try {
            const response = await fetch(
              `/api/flow360/resources/SurfaceMesh/${encodeURIComponent(resource.id)}/preview-mesh`,
              { signal: controller.signal },
            )
            if (!response.ok) throw new Error(`Preview HTTP ${response.status}`)
            const manifest = await response.json() as ViewerManifest
            if (manifest.format !== 'flow360-uvf') throw new Error('Comparison asset is not Flow360 UVF')
            const asset = await new UVFLoader().load(manifest.asset_url, { signal: controller.signal })
            try {
              histogram = createFieldHistogram(asset, selectedField)
            } finally {
              asset.dispose()
            }
          } catch (cause) {
            if (controller.signal.aborted) return
            qualityError = cause instanceof Error ? cause.message : String(cause)
          }
        }
        if (controller.signal.aborted) return
        dispatch({
          type: 'comparison-ready',
          comparison: {
            resource,
            detail,
            parameterDifferences: compareSurfaceParameters(
              surfaceComparisonParameters(currentDetail),
              surfaceComparisonParameters(detail),
            ),
            histogram,
            qualityError,
          },
        })
      } catch (cause) {
        if (controller.signal.aborted) return
        dispatch({
          type: 'comparison-error',
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    })()
    return () => controller.abort()
  }, [comparisonVersions, currentDetail, selectedField, state.compareId])

  return {
    ...state,
    comparisonVersions,
    setCompareId: (id: string) => dispatch({ type: 'compare-id', id }),
    requestCapture: () => dispatch({ type: 'capture' }),
    runRemediation: async (task: () => Promise<void>) => {
      dispatch({ type: 'remediation-start' })
      try {
        await task()
        dispatch({ type: 'remediation-done' })
      } catch (cause) {
        dispatch({
          type: 'remediation-error',
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    },
  }
}
