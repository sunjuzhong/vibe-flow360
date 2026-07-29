import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import type { Viewer3D as Viewer3DComponent } from './Viewer3D'

const Viewer = lazy(() => import('./Viewer3D').then((module) => ({ default: module.Viewer3D })))

export type {
  BoundingBoxData,
  MeshGroupData,
  ViewerManifest,
  ViewerSelection,
  ViewerState,
} from './Viewer3D'

export function LazyViewer3D(props: ComponentProps<typeof Viewer3DComponent>) {
  return (
    <Suspense fallback={<div className="viewer-3d viewer-loading"><div className="viewer-spinner" /><p>Loading viewer…</p></div>}>
      <Viewer {...props} />
    </Suspense>
  )
}
