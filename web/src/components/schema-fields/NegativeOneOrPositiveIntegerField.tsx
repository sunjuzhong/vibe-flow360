import type { ReactNode } from 'react'
import { FieldShell, type FieldMessage } from '../FieldShell'

type UnionDraft = { variant: number; value: unknown; values?: unknown[] }

type FieldIssue = { path?: string; message: string }

export default function NegativeOneOrPositiveIntegerField({
  draft,
  integerVariant,
  sentinelVariant,
  fieldID,
  title,
  path,
  help,
  description,
  status,
  hideLabel,
  required,
  disabled,
  messages,
  fieldIssues,
  onChange,
}: {
  draft: UnionDraft
  integerVariant: number
  sentinelVariant: number
  fieldID: string
  title: ReactNode
  path?: string
  help?: ReactNode
  description?: ReactNode
  status?: ReactNode
  hideLabel?: boolean
  required?: boolean
  disabled?: boolean
  messages?: FieldMessage[]
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
  const constraintMessage: FieldMessage = {
    key: 'constraint',
    level: valid ? 'success' : 'error',
    message: valid ? 'Use -1 for the end of the simulation; otherwise enter a positive integer.' : 'Enter -1 or a positive integer.',
  }
  return (
    <FieldShell
      id={fieldID}
      label={title}
      path={path}
      help={help}
      description={description}
      status={status}
      hideLabel={hideLabel}
      required={required}
      disabled={disabled}
      messages={[constraintMessage, ...(messages ?? fieldIssues.map((issue) => ({ ...issue, level: 'error' as const })))]}
      className={`schema-field schema-sentinel-integer${!valid || fieldIssues.length ? ' schema-field-invalid' : ''}`}
    >
      {(controlProps) => <input
        {...controlProps}
        type="number"
        step={1}
        value={raw}
        onChange={(event) => update(event.target.value)}
      />}
    </FieldShell>
  )
}
