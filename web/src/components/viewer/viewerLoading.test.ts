import { describe, expect, it } from 'vitest'
import { viewerLoadingLabel } from './viewerLoading'

describe('viewerLoadingLabel', () => {
  it('uses an indeterminate stage label when progress is unavailable', () => {
    expect(viewerLoadingLabel({ status: 'loading', message: 'Preparing 3D preview…' }))
      .toBe('Preparing 3D preview…')
    expect(viewerLoadingLabel({ status: 'loading', progress: 0 }))
      .toBe('Loading 3D preview…')
  })

  it('shows only meaningful in-flight resource progress', () => {
    expect(viewerLoadingLabel({ status: 'loading', message: 'Loading 3D resources…', progress: 0.42 }))
      .toBe('Loading 3D resources… 42%')
    expect(viewerLoadingLabel({ status: 'loading', message: 'Loading 3D resources…', progress: 1 }))
      .toBe('Loading 3D resources…')
  })
})
