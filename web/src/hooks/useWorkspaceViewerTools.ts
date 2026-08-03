import { useMemo } from 'react'
import type { ProjectAnnotationsModel } from './useProjectAnnotations'
import { useDistanceTool } from './useDistanceTool'
import { useViewerTools } from './useViewerTools'
import type { ViewerOverlayContent } from '../components/viewer/LazyViewer3D'
import type { BasicToolId } from '../lib/viewer-tools/basic-tools'
import type { CoordinateFrame, JsonValue, ResourceRef } from '../lib/viewer-tools/types'

export function useWorkspaceViewerTools({
  projectId,
  resourceRef,
  assetRef = resourceRef,
  coordinateFrame,
  annotationsModel,
  unit,
}: {
  projectId: string
  resourceRef: ResourceRef
  assetRef?: ResourceRef
  coordinateFrame?: CoordinateFrame
  annotationsModel: ProjectAnnotationsModel<JsonValue>
  unit?: string | null
}) {
  const distance = useDistanceTool({
    projectId, resourceRef, assetRef, coordinateFrame, annotationsModel, unit,
  })
  const basic = useViewerTools({
    projectId, resourceRef, assetRef, coordinateFrame, annotationsModel,
  })

  const overlays = useMemo<ViewerOverlayContent>(() => {
    const active = basic.active ? basic.overlays : distance.overlays
    return {
      saved: [...(distance.overlays.saved ?? []), ...(basic.overlays.saved ?? [])],
      draft: active.draft,
      hover: active.hover,
      visible: active.visible,
    }
  }, [basic.active, basic.overlays, distance.overlays])

  const activateDistance = () => {
    basic.cancel()
    distance.activate()
  }
  const activateBasic = (toolId: BasicToolId) => {
    distance.discard()
    basic.activate(toolId)
  }
  const closeActive = () => {
    distance.discard()
    basic.cancel()
  }

  const distanceVisible = distance.session.status !== 'idle' && distance.session.status !== 'cancelled'
  const basicVisible = basic.session.status !== 'idle' && basic.session.status !== 'cancelled'

  return {
    distance,
    basic,
    overlays,
    toolInput: basic.active ? basic.toolInput : distance.toolInput,
    onDoubleClick: basic.onDoubleClick,
    activeToolId: basicVisible ? basic.activeToolId : distanceVisible ? 'distance' as const : null,
    panelOpen: basicVisible || distanceVisible,
    activateDistance,
    activateBasic,
    closeActive,
  }
}

export type WorkspaceViewerToolsModel = ReturnType<typeof useWorkspaceViewerTools>
