import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createEngineeringLightRig, precisionFallbackNotice, shouldKeepPreviousAssetVisible, Viewer3D, ViewerNavCube } from './Viewer3D'

describe('Viewer3D layout state', () => {
  it('keeps the previous frame visible during a seamless asset transition', () => {
    expect(shouldKeepPreviousAssetVisible(true, true, 'loading')).toBe(true)
    expect(shouldKeepPreviousAssetVisible(false, true, 'loading')).toBe(false)
    expect(shouldKeepPreviousAssetVisible(true, false, 'loading')).toBe(false)
    expect(shouldKeepPreviousAssetVisible(true, true, 'ready')).toBe(false)
  })

  it('marks the container as loading without rendering the controls gutter content', () => {
    const html = renderToStaticMarkup(
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
    const visible = renderToStaticMarkup(
      <Viewer3D manifest={manifest} state={{ status: 'loading' }} />,
    )
    const suppressed = renderToStaticMarkup(
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
