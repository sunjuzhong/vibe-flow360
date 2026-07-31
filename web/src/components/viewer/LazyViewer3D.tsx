import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import type { Viewer3D as Viewer3DComponent } from './Viewer3D'

import type { UVFFieldExtrema, UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe } from '../../lib/uvf-three'

const Viewer = lazy(() => import('./Viewer3D').then((module) => ({ default: module.Viewer3D })))

export type {
  BoundingBoxData,
  MeshGroupData,
  ViewerClipPlane,
  ViewerManifest,
  ViewerSelection,
  ViewerState,
} from './Viewer3D'

export type ViewerToolbarProps = {
  wireframe?: boolean
  onWireframeChange?: (wireframe: boolean) => void
  entityVisibility?: Record<string, boolean>
  onEntityVisibilityChange?: (visibility: Record<string, boolean>) => void
  onFieldsDiscovered?: (fields: UVFFieldInfo[]) => void
  selectedField?: string | null
  onSelectedFieldChange?: (field: string | null) => void
  fieldNames?: string[]
  fieldRange?: [number, number] | null
  onFieldHistogramChange?: (histogram: UVFFieldHistogram | null) => void
  onFieldExtremaChange?: (extrema: UVFFieldExtrema | null) => void
  onFieldProbe?: (probe: UVFFieldProbe | null) => void
  focusTarget?: [number, number, number] | null
  clipPlane?: import('./Viewer3D').ViewerClipPlane | null
  measurementPoints?: Array<[number, number, number]>
  onPickPoint?: (point: [number, number, number]) => void
  captureRequest?: number
  onCapture?: (dataUrl: string) => void
  showFieldPanel?: boolean
  showEntityLegend?: boolean
  toolbar?: React.ReactNode
}

export function LazyViewer3D(props: ComponentProps<typeof Viewer3DComponent>) {
  return (
    <Suspense fallback={<div className="viewer-3d viewer-loading"><div className="viewer-spinner" /><p>Loading viewer…</p></div>}>
      <Viewer {...props} />
    </Suspense>
  )
}
