import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import type { Viewer3D as Viewer3DComponent } from './Viewer3D'

import type { UVFEntityInfo, UVFFieldExtrema, UVFFieldFilter, UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe } from '../../lib/uvf-three'

const Viewer = lazy(() => import('./Viewer3D').then((module) => ({ default: module.Viewer3D })))

export type {
  BoundingBoxData,
  MeshGroupData,
  ViewerClipPlane,
  ViewerCameraCommand,
  ViewerCameraState,
  ViewerAssetStats,
  ViewerManifest,
  ViewerOverlayContent,
  ViewerSelection,
  ViewerState,
} from './Viewer3D'

export type ViewerToolbarProps = {
  wireframe?: boolean
  onWireframeChange?: (wireframe: boolean) => void
  entityVisibility?: Record<string, boolean>
  onEntityVisibilityChange?: (visibility: Record<string, boolean>) => void
  onFieldsDiscovered?: (fields: UVFFieldInfo[]) => void
  onEntitiesDiscovered?: (entities: UVFEntityInfo[]) => void
  selectedField?: string | null
  onSelectedFieldChange?: (field: string | null) => void
  fieldNames?: string[]
  fieldEntityIds?: string[]
  fieldStateResetKey?: string | number
  fieldRange?: [number, number] | null
  onFieldHistogramChange?: (histogram: UVFFieldHistogram | null) => void
  onFieldExtremaChange?: (extrema: UVFFieldExtrema | null) => void
  onFieldProbe?: (probe: UVFFieldProbe | null) => void
  fieldFilter?: UVFFieldFilter | null
  onFieldFilterMatchCount?: (count: number) => void
  onAssetStatsChange?: (stats: import('./Viewer3D').ViewerAssetStats | null) => void
  focusTarget?: [number, number, number] | null
  clipPlane?: import('./Viewer3D').ViewerClipPlane | null
  captureRequest?: number
  onCapture?: (dataUrl: string) => void
  showFieldPanel?: boolean
  fieldPanelExtra?: React.ReactNode | ((context: import('./Viewer3D').ViewerFieldPanelContext) => React.ReactNode)
  showVectorControls?: boolean
  showEntityLegend?: boolean
  showWarnings?: boolean
  toolbar?: React.ReactNode
  topToolbar?: React.ReactNode
  floatingPanel?: React.ReactNode
}

export function LazyViewer3D(props: ComponentProps<typeof Viewer3DComponent>) {
  return (
    <Suspense fallback={<div className="viewer-3d viewer-loading"><div className="viewer-spinner" /><p>Loading viewer…</p></div>}>
      <Viewer {...props} />
    </Suspense>
  )
}
