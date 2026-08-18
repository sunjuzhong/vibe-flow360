import { useEffect, useRef, useState } from 'react'

type Props = {
  active: boolean
  progress: number
  title: string
  detail: string
  completeTitle: string
  completeDetail: string
}

export function clampLoadingProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.min(100, Math.max(0, Math.round(progress)))
}

export default function ProjectLoadingOverlay({ active, progress, title, detail, completeTitle, completeDetail }: Props) {
  const [visible, setVisible] = useState(active)
  const [completing, setCompleting] = useState(false)
  const hideTimer = useRef<number | null>(null)

  useEffect(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    if (active) {
      setVisible(true)
      setCompleting(false)
      return
    }
    if (!visible) return
    setCompleting(true)
    hideTimer.current = window.setTimeout(() => {
      setVisible(false)
      setCompleting(false)
    }, 320)
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    }
  }, [active, visible])

  if (!visible) return null
  const displayProgress = completing ? 100 : clampLoadingProgress(progress)

  return (
    <div className={`project-loading-overlay ${completing ? 'is-completing' : ''}`} role="status" aria-live="polite" aria-atomic="true">
      <div className="project-loading-card">
        <div className="project-loading-visual" aria-hidden="true">
          <span className="project-loading-orbit orbit-a" />
          <span className="project-loading-orbit orbit-b" />
          <span className="project-loading-core" />
        </div>
        <div className="project-loading-copy">
          <strong>{completing ? completeTitle : title}</strong>
          <span>{completing ? completeDetail : detail}</span>
        </div>
        <span className="project-loading-percent" aria-hidden="true">{displayProgress}%</span>
        <div
          className="project-loading-progress"
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={displayProgress}
        >
          <span style={{ width: `${displayProgress}%` }} />
        </div>
      </div>
    </div>
  )
}
