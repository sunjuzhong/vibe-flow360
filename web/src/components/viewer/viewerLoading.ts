export type ViewerLoadingState = {
  status: 'loading'
  message?: string
  progress?: number
}

export function viewerLoadingLabel(state: ViewerLoadingState): string {
  const message = state.message?.trim() || 'Loading 3D preview…'
  const progress = state.progress

  // Zero means no resource has completed yet, while one means the downloaded
  // buffers may still be decoding. Neither is a useful percentage to display.
  if (progress === undefined || !Number.isFinite(progress) || progress <= 0 || progress >= 1) {
    return message
  }

  return `${message} ${Math.round(progress * 100)}%`
}
