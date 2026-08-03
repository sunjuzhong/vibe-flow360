import * as THREE from 'three'

export interface LabelCanvasMetrics {
  readonly pixelRatio: number
  readonly fontSize: number
  readonly padding: number
  readonly cssWidth: number
  readonly cssHeight: number
  readonly canvasWidth: number
  readonly canvasHeight: number
}

export function calculateLabelCanvasMetrics(
  textWidth: number,
  fontSize = 14,
  pixelRatio = 1,
): LabelCanvasMetrics {
  const ratio = Math.max(1, pixelRatio)
  const size = Math.max(1, fontSize)
  const padding = Math.ceil(size * 0.35)
  const cssWidth = Math.max(1, Math.ceil(textWidth + padding * 2))
  const cssHeight = Math.max(1, Math.ceil(size * 1.4 + padding * 2))
  return {
    pixelRatio: ratio,
    fontSize: size,
    padding,
    cssWidth,
    cssHeight,
    canvasWidth: Math.ceil(cssWidth * ratio),
    canvasHeight: Math.ceil(cssHeight * ratio),
  }
}

export interface LabelTextureResult {
  readonly texture: THREE.Texture
  readonly aspectRatio: number
  readonly metrics: LabelCanvasMetrics
}

export function createLabelTexture(
  text: string,
  color: string,
  fontSize: number,
  pixelRatio: number,
): LabelTextureResult {
  if (typeof document === 'undefined') {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    texture.needsUpdate = true
    const metrics = calculateLabelCanvasMetrics(text.length * fontSize * 0.6, fontSize, pixelRatio)
    return { texture, aspectRatio: metrics.cssWidth / metrics.cssHeight, metrics }
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    const texture = new THREE.CanvasTexture(canvas)
    const metrics = calculateLabelCanvasMetrics(text.length * fontSize * 0.6, fontSize, pixelRatio)
    return { texture, aspectRatio: metrics.cssWidth / metrics.cssHeight, metrics }
  }

  context.font = `600 ${fontSize}px system-ui, sans-serif`
  const metrics = calculateLabelCanvasMetrics(
    context.measureText(text).width,
    fontSize,
    pixelRatio,
  )
  canvas.width = metrics.canvasWidth
  canvas.height = metrics.canvasHeight
  canvas.style.width = `${metrics.cssWidth}px`
  canvas.style.height = `${metrics.cssHeight}px`

  context.scale(metrics.pixelRatio, metrics.pixelRatio)
  context.font = `600 ${metrics.fontSize}px system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineWidth = Math.max(2, metrics.fontSize * 0.22)
  context.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  context.strokeText(text, metrics.cssWidth / 2, metrics.cssHeight / 2)
  context.fillStyle = color
  context.fillText(text, metrics.cssWidth / 2, metrics.cssHeight / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return { texture, aspectRatio: metrics.cssWidth / metrics.cssHeight, metrics }
}
