import type { ReactNode } from 'react'

type Props = {
  value: unknown
  empty?: string
  className?: string
}

export function humanizeDataKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function primitiveValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="structured-data-empty">Not reported</span>
  }
  if (typeof value === 'boolean') {
    return <span className={`structured-data-boolean ${value ? 'true' : 'false'}`}>{value ? 'Yes' : 'No'}</span>
  }
  if (typeof value === 'number') {
    return <span className="structured-data-number">{value.toLocaleString()}</span>
  }
  return <span className="structured-data-string">{String(value)}</span>
}

function collectionLabel(value: unknown[] | Record<string, unknown>): string {
  const count = Array.isArray(value) ? value.length : Object.keys(value).length
  return `${count} ${Array.isArray(value) ? (count === 1 ? 'item' : 'items') : (count === 1 ? 'property' : 'properties')}`
}

function StructuredNode({ value, depth, label }: { value: unknown; depth: number; label?: string }) {
  if (!Array.isArray(value) && !isRecord(value)) {
    return <>{primitiveValue(value)}</>
  }

  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [`Item ${index + 1}`, item])
    : Object.entries(value)

  if (!entries.length) {
    return <span className="structured-data-empty">Empty {Array.isArray(value) ? 'list' : 'object'}</span>
  }

  const rows = (
    <dl className="structured-data-list">
      {entries.map(([key, child]) => {
        const nested = Array.isArray(child) || isRecord(child)
        if (nested) {
          return (
            <div className="structured-data-row nested" key={key}>
              <dt>{Array.isArray(value) ? key : humanizeDataKey(key)}</dt>
              <dd><StructuredNode value={child} depth={depth + 1} /></dd>
            </div>
          )
        }
        return (
          <div className="structured-data-row" key={key}>
            <dt>{Array.isArray(value) ? key : humanizeDataKey(key)}</dt>
            <dd><StructuredNode value={child} depth={depth + 1} label={key} /></dd>
          </div>
        )
      })}
    </dl>
  )

  if (depth === 0) return rows

  return (
    <details className="structured-data-group" open={depth < 2}>
      <summary>
        <span>{label ? humanizeDataKey(label) : Array.isArray(value) ? 'List' : 'Object'}</span>
        <small>{collectionLabel(value)}</small>
      </summary>
      {rows}
    </details>
  )
}

export function StructuredDataView({ value, empty = 'Not reported', className = '' }: Props) {
  const emptyValue = value === null || value === undefined
    || (Array.isArray(value) && value.length === 0)
    || (isRecord(value) && Object.keys(value).length === 0)

  if (emptyValue) return <div className="structured-data-view empty">{empty}</div>

  return (
    <div className={`structured-data-view ${className}`.trim()}>
      <StructuredNode value={value} depth={0} />
    </div>
  )
}
