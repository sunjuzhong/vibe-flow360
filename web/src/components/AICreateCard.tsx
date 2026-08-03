import { ArrowRight, CheckCircle2, Loader2, Sparkles, WandSparkles } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { api, type AICreateResult, type FolderNode } from '../api/client'

const progressStages = [
  'Understanding the engineering goal',
  'Generating geometry and boundary intent',
  'Creating the Flow360 Project',
  'Loading mesh and Case parameters',
]

export default function AICreateCard({
  folder,
  onCreated,
}: {
  folder: FolderNode | null
  onCreated: (result: AICreateResult) => void
}) {
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
    <section className="ai-create-card" aria-labelledby="ai-create-title">
      <div className="ai-create-copy">
        <span className="ai-create-icon"><WandSparkles size={19} /></span>
        <div>
          <p className="eyebrow">AI CREATE</p>
          <h2 id="ai-create-title">Describe the simulation you want</h2>
          <p>AI creates the geometry, Project, and a reviewable plan with mesh and solver parameters already loaded.</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          placeholder="例如：帮我实现一个圆柱扰流的仿真试验"
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
        <button className="ai-create-example" type="button" onClick={() => { setIntent('帮我实现一个圆柱扰流的仿真试验'); inputRef.current?.focus() }}>
          Try “圆柱扰流仿真”
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
    </section>
  )
}
