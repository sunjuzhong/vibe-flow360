import * as THREE from 'three'
import type { UVFAsset } from './types'

type LICCapture = {
  source: THREE.Mesh
  mesh: THREE.Mesh
}

const CAPTURE_VERTEX_SHADER = `
  attribute vec3 uvfVector;
  varying vec2 vScreenDirection;
  varying float vMagnitude;

  void main() {
    vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vMagnitude = length(uvfVector);
    vec3 direction = vMagnitude > 1e-12 ? uvfVector / vMagnitude : vec3(0.0);
    vec4 clipEnd = projectionMatrix * modelViewMatrix * vec4(position + direction, 1.0);
    vec2 startNDC = clipPosition.xy / max(abs(clipPosition.w), 1e-8);
    vec2 endNDC = clipEnd.xy / max(abs(clipEnd.w), 1e-8);
    vScreenDirection = endNDC - startNDC;
    gl_Position = clipPosition;
  }
`

const CAPTURE_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vScreenDirection;
  varying float vMagnitude;

  void main() {
    if (vMagnitude <= 1e-12 || length(vScreenDirection) <= 1e-9) discard;
    vec2 direction = normalize(vScreenDirection);
    gl_FragColor = vec4(direction * 0.5 + 0.5, 0.0, 1.0);
  }
`

const FULLSCREEN_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const LIC_FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D uVectors;
  uniform sampler2D uNoise;
  uniform vec2 uResolution;
  uniform float uStepPixels;
  uniform float uContrast;
  uniform float uPhase;
  varying vec2 vUv;

  vec2 pixelDirection(vec2 encoded) {
    vec2 ndcDirection = encoded * 2.0 - 1.0;
    vec2 pixels = ndcDirection * uResolution;
    float magnitude = length(pixels);
    return magnitude > 1e-8 ? pixels / magnitude : vec2(0.0);
  }

  float noiseAt(vec2 position) {
    return texture2D(uNoise, position * uResolution / 256.0).r;
  }

  void main() {
    vec4 centerVector = texture2D(uVectors, vUv);
    if (centerVector.a < 0.5) discard;

    float centerKernel = 1.0 + 0.62 * cos(uPhase) + 0.18 * cos(uPhase * 2.0 + 0.7);
    float convolution = noiseAt(vUv) * centerKernel;
    float weightSum = centerKernel;
    vec2 forwardPosition = vUv;
    vec2 backwardPosition = vUv;
    vec2 forwardDirection = pixelDirection(centerVector.rg);
    vec2 backwardDirection = -forwardDirection;
    float forwardActive = 1.0;
    float backwardActive = 1.0;

    for (int index = 1; index <= 14; index++) {
      float windowWeight = 1.0 - float(index) / 15.0;
      float streamlineOffset = float(index) * 0.84;
      float forwardKernel = windowWeight * (
        1.0 + 0.62 * cos(streamlineOffset + uPhase)
        + 0.18 * cos(streamlineOffset * 2.0 + uPhase * 2.0 + 0.7)
      );
      float backwardKernel = windowWeight * (
        1.0 + 0.62 * cos(-streamlineOffset + uPhase)
        + 0.18 * cos(-streamlineOffset * 2.0 + uPhase * 2.0 + 0.7)
      );

      vec2 forwardStep = forwardDirection * uStepPixels / uResolution;
      forwardPosition += forwardStep;
      vec4 forwardSample = texture2D(uVectors, forwardPosition);
      forwardActive *= step(0.5, forwardSample.a)
        * step(0.0, forwardPosition.x) * step(forwardPosition.x, 1.0)
        * step(0.0, forwardPosition.y) * step(forwardPosition.y, 1.0);
      vec2 nextForward = pixelDirection(forwardSample.rg);
      if (dot(nextForward, forwardDirection) < 0.0) nextForward = -nextForward;
      if (length(nextForward) > 0.0) forwardDirection = nextForward;
      convolution += noiseAt(forwardPosition) * forwardKernel * forwardActive;
      weightSum += forwardKernel * forwardActive;

      vec2 backwardStep = backwardDirection * uStepPixels / uResolution;
      backwardPosition += backwardStep;
      vec4 backwardSample = texture2D(uVectors, backwardPosition);
      backwardActive *= step(0.5, backwardSample.a)
        * step(0.0, backwardPosition.x) * step(backwardPosition.x, 1.0)
        * step(0.0, backwardPosition.y) * step(backwardPosition.y, 1.0);
      vec2 nextBackward = pixelDirection(backwardSample.rg);
      if (dot(nextBackward, backwardDirection) < 0.0) nextBackward = -nextBackward;
      if (length(nextBackward) > 0.0) backwardDirection = nextBackward;
      convolution += noiseAt(backwardPosition) * backwardKernel * backwardActive;
      weightSum += backwardKernel * backwardActive;
    }

    float lic = convolution / max(weightSum, 1e-6);
    float strand = 1.0 - smoothstep(0.34, 0.66, lic);
    vec3 ink = vec3(0.055, 0.16, 0.48);
    gl_FragColor = vec4(ink, strand * uContrast);
  }
`

function createTarget(): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  })
  target.texture.generateMipmaps = false
  return target
}

function createNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  let state = 0x9e3779b9
  for (let index = 0; index < size * size; index++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    const value = state & 0xff
    const offset = index * 4
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function createFullscreenQuad(material: THREE.Material): THREE.Mesh {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  return quad
}

export class UVFScreenSpaceLIC {
  private readonly captures: LICCapture[]
  private readonly vectorScene = new THREE.Scene()
  private readonly vectorTarget = createTarget()
  private readonly licTarget = createTarget()
  private readonly noiseTexture = createNoiseTexture()
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly licScene = new THREE.Scene()
  private readonly compositeScene = new THREE.Scene()
  private readonly licMaterial: THREE.ShaderMaterial
  private readonly compositeMaterial: THREE.MeshBasicMaterial
  private lastVectorKey = ''
  private lastLICRenderTime = Number.NEGATIVE_INFINITY
  private readonly animationStartedAt = typeof performance === 'undefined' ? Date.now() : performance.now()

  constructor(sources: Array<{ mesh: THREE.Mesh; vector: THREE.BufferAttribute }>) {
    const captureMaterial = new THREE.ShaderMaterial({
      vertexShader: CAPTURE_VERTEX_SHADER,
      fragmentShader: CAPTURE_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending,
    })
    captureMaterial.toneMapped = false
    this.captures = sources.map(({ mesh: source, vector }) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', source.geometry.getAttribute('position'))
      geometry.setAttribute('uvfVector', vector)
      if (source.geometry.getIndex()) geometry.setIndex(source.geometry.getIndex())
      geometry.setDrawRange(source.geometry.drawRange.start, source.geometry.drawRange.count)
      const mesh = new THREE.Mesh(geometry, captureMaterial)
      mesh.matrixAutoUpdate = false
      mesh.frustumCulled = false
      this.vectorScene.add(mesh)
      return { source, mesh }
    })

    this.licMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uVectors: { value: this.vectorTarget.texture },
        uNoise: { value: this.noiseTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uStepPixels: { value: 1.35 },
        uContrast: { value: 0.68 },
        uPhase: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: LIC_FRAGMENT_SHADER,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
    this.licMaterial.toneMapped = false
    this.licScene.add(createFullscreenQuad(this.licMaterial))

    this.compositeMaterial = new THREE.MeshBasicMaterial({
      map: this.licTarget.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    this.compositeMaterial.toneMapped = false
    this.compositeScene.add(createFullscreenQuad(this.compositeMaterial))
  }

  get sourceCount(): number {
    return this.captures.length
  }

  update(renderer: THREE.WebGLRenderer, camera: THREE.Camera, canvasWidth: number, canvasHeight: number, navigating = false): void {
    const now = typeof performance === 'undefined' ? Date.now() : performance.now()
    const scale = navigating ? 0.45 : 0.7
    const width = Math.max(1, Math.round(canvasWidth * scale))
    const height = Math.max(1, Math.round(canvasHeight * scale))
    camera.updateMatrixWorld()
    for (const { source, mesh } of this.captures) {
      source.updateWorldMatrix(true, false)
      mesh.matrix.copy(source.matrixWorld)
      mesh.visible = source.visible
    }
    const cameraKey = [...camera.projectionMatrix.elements, ...camera.matrixWorldInverse.elements]
      .map((value) => value.toFixed(7)).join(',')
    const sourceKey = this.captures.map(({ source }) => `${source.visible}:${source.matrixWorld.elements.map((value) => value.toFixed(6)).join(',')}`).join('|')
    const key = `${width}x${height}|${cameraKey}|${sourceKey}`
    const vectorChanged = key !== this.lastVectorKey
    const animationInterval = 1000 / (navigating ? 15 : 24)
    if (!vectorChanged && now - this.lastLICRenderTime < animationInterval) return
    this.lastVectorKey = key
    this.lastLICRenderTime = now
    const resized = this.vectorTarget.width !== width || this.vectorTarget.height !== height
    if (resized) {
      this.vectorTarget.setSize(width, height)
      this.licTarget.setSize(width, height)
      this.licMaterial.uniforms.uResolution.value.set(width, height)
    }
    this.licMaterial.uniforms.uPhase.value = ((now - this.animationStartedAt) / 1000) * 6.0

    const previousTarget = renderer.getRenderTarget()
    const previousClearColor = renderer.getClearColor(new THREE.Color())
    const previousClearAlpha = renderer.getClearAlpha()
    const previousAutoClear = renderer.autoClear
    renderer.autoClear = true
    renderer.setClearColor(0x000000, 0)
    if (vectorChanged || resized) {
      renderer.setRenderTarget(this.vectorTarget)
      renderer.clear(true, true, true)
      renderer.render(this.vectorScene, camera)
    }
    renderer.setRenderTarget(this.licTarget)
    renderer.clear(true, true, true)
    renderer.render(this.licScene, this.screenCamera)
    renderer.setRenderTarget(previousTarget)
    renderer.setClearColor(previousClearColor, previousClearAlpha)
    renderer.autoClear = previousAutoClear
  }

  composite(renderer: THREE.WebGLRenderer): void {
    const previousAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.compositeScene, this.screenCamera)
    renderer.autoClear = previousAutoClear
  }

  dispose(): void {
    const captureMaterials = new Set<THREE.Material>()
    for (const { mesh } of this.captures) {
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => captureMaterials.add(material))
    }
    captureMaterials.forEach((material) => material.dispose())
    for (const scene of [this.licScene, this.compositeScene]) {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
    }
    this.licMaterial.dispose()
    this.compositeMaterial.dispose()
    this.vectorTarget.dispose()
    this.licTarget.dispose()
    this.noiseTexture.dispose()
  }
}

export function createScreenSpaceLIC(
  asset: UVFAsset,
  fieldName: string | null,
  entityIds?: string[] | null,
): UVFScreenSpaceLIC | null {
  const field = fieldName ? asset.fields.find((candidate) => candidate.name === fieldName) : null
  if (!field || field.kind !== 'vector') return null
  const sources: Array<{ mesh: THREE.Mesh; vector: THREE.BufferAttribute }> = []
  asset.object.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (object.userData.uvfType !== 'Face' && object.userData.uvfType !== 'SolidGeometry') return
    const entityId = String(object.userData.groupId ?? object.userData.entityId ?? '')
    if (entityIds && !entityIds.includes(entityId)) return
    const vector = object.geometry.getAttribute(field.name)
    if (!(vector instanceof THREE.BufferAttribute) || vector.itemSize < 2) return
    sources.push({ mesh: object, vector })
  })
  return sources.length ? new UVFScreenSpaceLIC(sources) : null
}
