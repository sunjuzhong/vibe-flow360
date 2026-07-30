import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import type { Viewer3D as Viewer3DComponent } from './Viewer3D'

import type { UVFFieldInfo } from '../../lib/uvf-three'

const Viewer = lazy(() => import('./Viewer3D').then((module) => ({ default: module.Viewer3D })))

export type {
  BoundingBoxData,
  MeshGroupData,
  ViewerManifest,
  ViewerSelection,
  ViewerState,
} from './Viewer3D'

export type ViewerToolbarProps = {
  wireframe?: boolean
  onWireframeChange?: (wireframe: boolean) => void
  onFieldsDiscovered?: (fields: UVFFieldInfo[]) => void
  toolbar?: React.ReactNode
}

export function LazyViewer3D(props: ComponentProps<typeof Viewer3DComponent>) {
  return (
    <Suspense fallback={<div className="viewer-3d viewer-loading"><div className="viewer-spinner" /><p>Loading viewer…</p></div>}>
      <Viewer {...props} />
    </Suspense>
  )
}
