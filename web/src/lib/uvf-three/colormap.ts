import * as THREE from 'three'
import type { UVFFieldInfo } from './types'

export type ColormapName = 'viridis' | 'turbo' | 'coolwarm' | 'plasma' | 'grayscale'

export const DEFAULT_COLORMAP: ColormapName = 'turbo'

const VIRIDIS_STOPS: [number, number, number][] = [
  [0.267, 0.005, 0.329],
  [0.283, 0.141, 0.458],
  [0.254, 0.265, 0.530],
  [0.207, 0.372, 0.553],
  [0.164, 0.471, 0.558],
  [0.128, 0.567, 0.551],
  [0.135, 0.659, 0.518],
  [0.267, 0.749, 0.441],
  [0.478, 0.821, 0.318],
  [0.741, 0.873, 0.150],
  [0.993, 0.906, 0.144],
]

const TURBO_STOPS: [number, number, number][] = [
  [0.190, 0.072, 0.233],
  [0.270, 0.210, 0.520],
  [0.277, 0.385, 0.730],
  [0.195, 0.575, 0.870],
  [0.118, 0.735, 0.780],
  [0.208, 0.860, 0.560],
  [0.460, 0.930, 0.320],
  [0.720, 0.960, 0.160],
  [0.920, 0.920, 0.150],
  [0.980, 0.780, 0.150],
  [0.960, 0.470, 0.130],
  [0.850, 0.200, 0.150],
  [0.620, 0.050, 0.080],
]

const COOLWARM_STOPS: [number, number, number][] = [
  [0.230, 0.299, 0.754],
  [0.365, 0.424, 0.846],
  [0.556, 0.565, 0.914],
  [0.730, 0.710, 0.952],
  [0.866, 0.823, 0.952],
  [0.950, 0.900, 0.890],
  [0.952, 0.823, 0.730],
  [0.914, 0.565, 0.556],
  [0.846, 0.424, 0.365],
  [0.754, 0.299, 0.230],
]

const PLASMA_STOPS: [number, number, number][] = [
  [0.050, 0.030, 0.528],
  [0.220, 0.016, 0.607],
  [0.390, 0.008, 0.640],
  [0.530, 0.040, 0.600],
  [0.660, 0.105, 0.500],
  [0.770, 0.195, 0.380],
  [0.860, 0.310, 0.260],
  [0.920, 0.440, 0.150],
  [0.955, 0.580, 0.060],
  [0.960, 0.720, 0.020],
  [0.940, 0.870, 0.120],
]

const GRAYSCALE_STOPS: [number, number, number][] = [
  [0, 0, 0],
  [1, 1, 1],
]

const COLORMAPS: Record<ColormapName, [number, number, number][]> = {
  viridis: VIRIDIS_STOPS,
  turbo: TURBO_STOPS,
  coolwarm: COOLWARM_STOPS,
  plasma: PLASMA_STOPS,
  grayscale: GRAYSCALE_STOPS,
}

export function listColormaps(): ColormapName[] {
  return Object.keys(COLORMAPS) as ColormapName[]
}

export function sampleColormap(t: number, name: ColormapName = DEFAULT_COLORMAP): THREE.Color {
  const stops = COLORMAPS[name] ?? VIRIDIS_STOPS
  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (stops.length - 1)
  const lower = Math.floor(scaled)
  const upper = Math.min(lower + 1, stops.length - 1)
  const frac = scaled - lower
  const a = stops[lower]
  const b = stops[upper]
  return new THREE.Color(
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  )
}

export function applyScalarField(
  values: Float32Array,
  field: UVFFieldInfo,
  colormap: ColormapName = DEFAULT_COLORMAP,
): Float32Array {
  const range = field.max - field.min || 1
  const colors = new Float32Array(values.length * 3)
  for (let i = 0; i < values.length; i++) {
    const t = (values[i] - field.min) / range
    const color = sampleColormap(t, colormap)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  return colors
}

export function createColormapTexture(
  name: ColormapName = DEFAULT_COLORMAP,
  resolution = 256,
): THREE.DataTexture {
  const data = new Uint8Array(resolution * 4)
  for (let i = 0; i < resolution; i++) {
    const t = i / (resolution - 1)
    const color = sampleColormap(t, name)
    data[i * 4] = Math.round(color.r * 255)
    data[i * 4 + 1] = Math.round(color.g * 255)
    data[i * 4 + 2] = Math.round(color.b * 255)
    data[i * 4 + 3] = 255
  }
  const texture = new THREE.DataTexture(data, resolution, 1, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}
