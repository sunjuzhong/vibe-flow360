import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

type UnionDraft = { variant: number; value: unknown; values?: unknown[] }

type FieldIssue = { path?: string; message: string }

export default function NegativeOneOrPositiveIntegerField({
  draft,
  integerVariant,
  sentinelVariant,
  fieldID,
  label,
  fieldIssues,
  onChange,
}: {
  draft: UnionDraft
  integerVariant: number
  sentinelVariant: number
  fieldID: string
  label: ReactNode
  fieldIssues: FieldIssue[]
  onChange: (value: unknown) => void
}) {
  const raw = String(draft.value ?? '')
  const numeric = raw.trim() === '' ? Number.NaN : Number(raw)
  const valid = numeric === -1 || (Number.isInteger(numeric) && numeric > 0)
  const update = (next: string) => {
    const parsed = next.trim() === '' ? Number.NaN : Number(next)
    const variant = parsed === -1 ? sentinelVariant : integerVariant
    const values = [...(draft.values ?? [])]
    values[draft.variant] = draft.value
    onChange({ variant, value: next, values })
  }
  const errorID = `${fieldID}-constraint`
  return (
    <label className={`schema-field schema-sentinel-integer${!valid || fieldIssues.length ? ' schema-field-invalid' : ''}`} htmlFor={fieldID}>
      {label}
      <input
        id={fieldID}
        type="number"
        step={1}
        value={raw}
        aria-invalid={!valid}
        aria-describedby={errorID}
        onChange={(event) => update(event.target.value)}
      />
      <small id={errorID} className={valid ? 'schema-field-hint' : 'schema-inline-error'} role={valid ? undefined : 'alert'}>
        {valid ? 'Use -1 for the end of the simulation; otherwise enter a positive integer.' : <><AlertCircle size={12} />Enter -1 or a positive integer.</>}
      </small>
      {fieldIssues.map((issue, index) => <small className="schema-inline-error" role="alert" key={`${issue.path}-${index}`}><AlertCircle size={12} />{issue.message}</small>)}
    </label>
  )
}
