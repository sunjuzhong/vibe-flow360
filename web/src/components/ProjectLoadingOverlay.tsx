import { useEffect, useRef, useState } from 'react'

type Props = {
  sessionKey: string
  active: boolean
  progress: number
  estimatedDurationMs: number
  title: string
  detail: string
  completeTitle: string
  completeDetail: string
}

export function clampLoadingProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.min(100, Math.max(0, Math.round(progress)))
}

export function simulatedLoadingProgress(elapsedMs: number, estimatedDurationMs: number): number {
  const duration = Math.max(1, estimatedDurationMs)
  const ratio = Math.min(1, Math.max(0, elapsedMs / duration))
  return clampLoadingProgress(4 + ratio * 90)
}

export default function ProjectLoadingOverlay({
  sessionKey,
  active,
  progress,
  estimatedDurationMs,
  title,
  detail,
  completeTitle,
  completeDetail,
}: Props) {
  const [visible, setVisible] = useState(active)
  const [completing, setCompleting] = useState(false)
  const [displayProgress, setDisplayProgress] = useState(() => clampLoadingProgress(progress))
  const hideTimer = useRef<number | null>(null)
  const visibleRef = useRef(active)
  const sessionRef = useRef(sessionKey)
  const completedSessionRef = useRef<string | null>(null)
  const startedAtRef = useRef(Date.now())

  useEffect(() => {
    if (active && completedSessionRef.current === sessionKey) return
    const sessionChanged = sessionRef.current !== sessionKey
    if (sessionChanged) {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
      sessionRef.current = sessionKey
      completedSessionRef.current = null
      startedAtRef.current = Date.now()
      if (!visibleRef.current) setDisplayProgress(clampLoadingProgress(progress))
    }
    if (active) {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
      visibleRef.current = true
      setVisible(true)
      setCompleting(false)
      return
    }
    if (!visibleRef.current || completedSessionRef.current === sessionKey) return
    completedSessionRef.current = sessionKey
    setCompleting(true)
    setDisplayProgress(100)
    hideTimer.current = window.setTimeout(() => {
      visibleRef.current = false
      setVisible(false)
      setCompleting(false)
    }, 320)
  }, [active, progress, sessionKey])

  useEffect(() => () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
  }, [])

  useEffect(() => {
    if (!active || completedSessionRef.current === sessionKey) return
    const update = () => {
      const simulated = simulatedLoadingProgress(Date.now() - startedAtRef.current, estimatedDurationMs)
      setDisplayProgress((current) => Math.max(current, simulated, clampLoadingProgress(progress)))
    }
    update()
    const timer = window.setInterval(update, 120)
    return () => window.clearInterval(timer)
  }, [active, estimatedDurationMs, progress, sessionKey])

  if (!visible) return null
  const renderedProgress = completing ? 100 : displayProgress

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
        <span className="project-loading-percent" aria-hidden="true">{renderedProgress}%</span>
        <div
          className="project-loading-progress"
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={renderedProgress}
        >
          <span style={{ width: `${renderedProgress}%` }} />
        </div>
      </div>
    </div>
  )
}
