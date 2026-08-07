import { Check, ChevronRight, Clipboard } from 'lucide-react'
import { useState } from 'react'

type Props = {
  value: unknown
  empty?: string
  className?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function valueKind(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function scalar(value: unknown) {
  if (value === null) return <span className="json-token null">null</span>
  if (typeof value === 'string') return <span className="json-token string">“{value}”</span>
  if (typeof value === 'number') return <span className="json-token number">{String(value)}</span>
  if (typeof value === 'boolean') return <span className="json-token boolean">{String(value)}</span>
  if (value === undefined) return <span className="json-token null">undefined</span>
  return <span className="json-token string">{String(value)}</span>
}

function collectionSummary(value: unknown[] | Record<string, unknown>) {
  const count = Array.isArray(value) ? value.length : Object.keys(value).length
  const noun = Array.isArray(value) ? (count === 1 ? 'item' : 'items') : (count === 1 ? 'field' : 'fields')
  return `${count} ${noun}`
}

function JsonNode({ value, name, depth }: { value: unknown; name?: string; depth: number }) {
  const collection = Array.isArray(value) || isRecord(value)
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((child, index) => [String(index), child])
    : isRecord(value) ? Object.entries(value) : []
  const [open, setOpen] = useState(depth < 2)

  if (!collection) {
    return (
      <div className="json-preview-row scalar-row">
        {name !== undefined && <span className="json-preview-key">{name}</span>}
        {scalar(value)}
      </div>
    )
  }

  return (
    <div className={`json-preview-node depth-${Math.min(depth, 4)}`}>
      <button type="button" className="json-preview-summary" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <ChevronRight size={13} className={open ? 'open' : ''} />
        {name !== undefined && <span className="json-preview-key">{name}</span>}
        <span className="json-preview-bracket">{Array.isArray(value) ? '[' : '{'}</span>
        <small>{collectionSummary(value)}</small>
        <span className="json-preview-bracket">{Array.isArray(value) ? ']' : '}'}</span>
      </button>
      {open && entries.length > 0 && (
        <div className="json-preview-children">
          {entries.map(([key, child]) => <JsonNode key={key} name={key} value={child} depth={depth + 1} />)}
        </div>
      )}
      {open && entries.length === 0 && <div className="json-preview-empty">Empty {valueKind(value)}</div>}
    </div>
  )
}

export default function JsonPreview({ value, empty = 'No JSON data.', className = '' }: Props) {
  const [copied, setCopied] = useState(false)
  const emptyValue = value === null || value === undefined
    || (Array.isArray(value) && value.length === 0)
    || (isRecord(value) && Object.keys(value).length === 0)

  if (emptyValue) return <div className={`json-preview empty ${className}`.trim()}>{empty}</div>

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className={`json-preview ${className}`.trim()}>
      <div className="json-preview-toolbar">
        <span>JSON Preview</span>
        <button type="button" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Clipboard size={13} />}{copied ? 'Copied' : 'Copy JSON'}</button>
      </div>
      <div className="json-preview-tree"><JsonNode value={value} depth={0} /></div>
    </div>
  )
}
