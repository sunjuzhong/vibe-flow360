import { ArrowRight, CheckCircle2, Loader2, Sparkles, WandSparkles, X } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { api, type AICreateResult, type FolderNode } from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'

const progressStages = [
  'Understanding the engineering goal',
  'Generating geometry and boundary intent',
  'Creating the Flow360 Project',
  'Loading mesh and Case parameters',
]

export default function AICreateModal({
  folder,
  onClose,
  onCreated,
}: {
  folder: FolderNode | null
  onClose: () => void
  onCreated: (result: AICreateResult) => void
}) {
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const closeWhenIdle = useCallback(() => { if (!busy) onClose() }, [busy, onClose])
  const modalRef = useFocusTrap<HTMLDivElement>(true, closeWhenIdle, 'textarea')

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setProgress((current) => Math.min(current + 1, progressStages.length - 1)), 1600)
    return () => window.clearInterval(timer)
  }, [busy])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!folder || !intent.trim() || busy) return
    setBusy(true)
    setError('')
    setProgress(0)
    try {
      const result = await api.aiCreate(intent.trim(), folder.id)
      setProgress(progressStages.length)
      onCreated(result)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="ai-create-overlay"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeWhenIdle() }}
    >
      <div
        ref={modalRef}
        className="ai-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-create-title"
        tabIndex={-1}
      >
      <button className="icon-button ai-create-close" type="button" onClick={closeWhenIdle} disabled={busy} aria-label="Close AI Create dialog">
        <X size={18} />
      </button>
      <div className="ai-create-copy">
        <span className="ai-create-icon"><WandSparkles size={19} /></span>
        <div>
          <p className="eyebrow">AI CREATE</p>
          <h2 id="ai-create-title">Describe the simulation you want</h2>
          <p>The built-in cylinder template uses validated analytic CAD. Other shapes require a supported STEP, IGES, or BREP model.</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          placeholder="For example: Set up an external-flow simulation around a circular cylinder."
          rows={3}
          disabled={busy}
          aria-label="Simulation requirement"
        />
        <div className="ai-create-form-footer">
          <span>{folder ? `Destination · ${folder.name}` : 'Select a destination folder first'}</span>
          <button type="submit" disabled={!folder || !intent.trim() || busy}>
            {busy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
            {busy ? 'Creating…' : 'Create project'}
            {!busy && <ArrowRight size={14} />}
          </button>
        </div>
      </form>
      {!busy && !intent && (
        <button className="ai-create-example" type="button" onClick={() => { setIntent('Set up an external-flow simulation around a circular cylinder.'); inputRef.current?.focus() }}>
          Try “cylinder flow simulation”
        </button>
      )}
      {busy && (
        <ol className="ai-create-progress" aria-live="polite">
          {progressStages.map((stage, index) => (
            <li key={stage} className={index < progress ? 'complete' : index === progress ? 'active' : ''}>
              {index < progress ? <CheckCircle2 size={13} /> : <span />}{stage}
            </li>
          ))}
        </ol>
      )}
      {error && <div className="ai-create-error">{error}</div>}
      <p className="ai-create-safety">Generated setup is saved as a reviewable draft. Paid remote meshing and solving still require approval.</p>
      </div>
    </div>
  )
}
