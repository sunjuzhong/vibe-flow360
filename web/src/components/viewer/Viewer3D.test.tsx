import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyViewerCameraState, captureViewerCameraState, createEngineeringLightRig, mergeViewerManifestMetadata, precisionFallbackNotice, shouldKeepPreviousAssetVisible, Viewer3D, ViewerNavCube, ViewerToolbar } from './Viewer3D'
import { I18nProvider } from '../../i18n'

function renderViewer(viewer: React.ReactNode) {
  return renderToStaticMarkup(<I18nProvider>{viewer}</I18nProvider>)
}

describe('Viewer3D layout state', () => {
  it('captures and applies a camera pose for linked viewers', () => {
    const source = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    source.position.set(3, 4, 5)
    source.up.set(0, 0, 1)
    source.zoom = 1.4
    const sourceTarget = new THREE.Vector3(0.5, -0.25, 1)
    const state = captureViewerCameraState(source, sourceTarget)

    const linked = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    const linkedTarget = new THREE.Vector3()
    applyViewerCameraState(linked, linkedTarget, state)

    expect(linked.position.toArray()).toEqual([3, 4, 5])
    expect(linkedTarget.toArray()).toEqual([0.5, -0.25, 1])
    expect(linked.up.toArray()).toEqual([0, 0, 1])
    expect(linked.zoom).toBe(1.4)
  })

  it('merges independently selectable asset-layer metadata', () => {
    const base = {
      format: 'flow360-uvf', asset_url: '/base.json', bounding_box: { min: [0, 0, 0], max: [1, 1, 1] },
      groups: [{ id: 'wall', name: 'Wall', color: '#fff', visible: true }], vertices: 10, elements: 4,
    } satisfies import('./Viewer3D').ViewerManifest
    const overlay = {
      format: 'flow360-uvf', asset_url: '/surface.json', bounding_box: { min: [-1, 0, 0], max: [2, 3, 1] },
      groups: [{ id: 'cylinder', name: 'Cylinder', color: '#789521', visible: true }], vertices: 20, elements: 8,
    } satisfies import('./Viewer3D').ViewerManifest
    expect(mergeViewerManifestMetadata([base, overlay])).toMatchObject({
      asset_url: '/base.json|/surface.json',
      bounding_box: { min: [-1, 0, 0], max: [2, 3, 1] },
      vertices: 30,
      elements: 12,
      groups: [{ id: 'wall' }, { id: 'cylinder' }],
    })
  })

  it('keeps the previous frame visible during a seamless asset transition', () => {
    expect(shouldKeepPreviousAssetVisible(true, true, 'loading')).toBe(true)
    expect(shouldKeepPreviousAssetVisible(false, true, 'loading')).toBe(false)
    expect(shouldKeepPreviousAssetVisible(true, false, 'loading')).toBe(false)
    expect(shouldKeepPreviousAssetVisible(true, true, 'ready')).toBe(false)
  })

  it('marks the container as loading without rendering the controls gutter content', () => {
    const html = renderViewer(
      <Viewer3D
        manifest={null}
        state={{ status: 'loading', message: 'Preparing 3D preview…' }}
        toolbar={<button type="button">Tools</button>}
      />,
    )

    expect(html).toContain('data-viewer-status="loading"')
    expect(html).toContain('Preparing 3D preview…')
    expect(html).not.toContain('viewer-controls-rail')
  })

  it('isolates canvas navigation gestures from page scrolling and rubber-band behavior', () => {
    const html = renderViewer(
      <Viewer3D manifest={null} state={{ status: 'loading' }} />,
    )

    expect(html).toContain('touch-action:none')
    expect(html).toContain('overscroll-behavior:contain')
  })

  it('allows resource pages to suppress a duplicate manifest warning', () => {
    const manifest = {
      format: 'flow360-uvf',
      asset_url: '',
      bounding_box: { min: [0, 0, 0], max: [1, 1, 1] },
      groups: [],
      vertices: 0,
      elements: 0,
      warnings: ['Showing Geometry as spatial context.'],
    } satisfies import('./Viewer3D').ViewerManifest
    const visible = renderViewer(
      <Viewer3D manifest={manifest} state={{ status: 'loading' }} />,
    )
    const suppressed = renderViewer(
      <Viewer3D manifest={manifest} state={{ status: 'loading' }} showWarnings={false} />,
    )

    expect(visible).toContain('Showing Geometry as spatial context.')
    expect(suppressed).not.toContain('Showing Geometry as spatial context.')
  })

  it('renders the shared camera controls for every ready 3D workspace', () => {
    const html = renderToStaticMarkup(
      <ViewerNavCube onCommand={() => undefined} />,
    )

    expect(html).toContain('aria-label="3D view navigation"')
    expect(html).toContain('aria-label="NavCube orientation controls"')
    expect(html).toContain('aria-label="View from positive X"')
    expect(html).toContain('aria-label="View from negative Y"')
    expect(html).toContain('aria-label="View from positive Z"')
    expect(html).toContain('aria-label="View from negative Z"')
    expect(html).toContain('aria-label="Isometric view"')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('Fit selected')
  })

  it('integrates display modes into the shared bottom toolbar', () => {
    const html = renderViewer(
      <ViewerToolbar displayControls={<button type="button">Wire</button>}>
        <button type="button">Fit</button>
      </ViewerToolbar>,
    )

    expect(html.match(/role="toolbar"/g)).toHaveLength(1)
    expect(html).toContain('viewer-toolbar-slot viewer-action-toolbar-slot')
    expect(html).toContain('viewer-display-controls')
    expect(html).toContain('aria-label="Viewer display modes"')
    expect(html.indexOf('Wire')).toBeLessThan(html.indexOf('Fit'))
    expect(html).not.toContain('viewer-view-toolbar')
  })

  it('uses balanced engineering lighting with an explicit underside fill', () => {
    const rig = createEngineeringLightRig()
    const lights = rig.children.filter((child): child is THREE.Light => child instanceof THREE.Light)
    const directionalLights = lights.filter(
      (light): light is THREE.DirectionalLight => light instanceof THREE.DirectionalLight,
    )

    const hemisphere = lights.find((light): light is THREE.HemisphereLight => (
      light instanceof THREE.HemisphereLight
    ))
    expect(hemisphere?.position.toArray()).toEqual([0, 0, 1])
    expect(lights.some((light) => light instanceof THREE.AmbientLight)).toBe(true)
    expect(directionalLights.some((light) => light.position.z > 0)).toBe(true)
    expect(directionalLights.some((light) => light.position.z < 0)).toBe(true)
  })

  it('explains an unavailable explicit LOD and the restored manifest default', () => {
    expect(precisionFallbackNotice(0, 1)).toBe(
      'Detail level L0 is unavailable for this resource. Restored manifest default L1.',
    )
  })
})
