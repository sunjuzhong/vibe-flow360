import { json, jsonParseLinter } from '@codemirror/lang-json'
import { lintGutter, linter } from '@codemirror/lint'
import { basicSetup, EditorView } from 'codemirror'
import { Braces, CheckCircle2, CircleAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'

type Props = {
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}

export function jsonSyntaxIssue(value: string): string {
  try {
    JSON.parse(value)
    return ''
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

export function formatJSON(value: string): string {
  return JSON.stringify(JSON.parse(value), null, 2)
}

export default function JsonEditor({ value, onChange, ariaLabel = 'JSON editor' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const issue = jsonSyntaxIssue(value)

  onChangeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      doc: value,
      extensions: [
        basicSetup,
        json(),
        lintGutter(),
        linter(jsonParseLinter()),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto', fontFamily: "'DM Mono', ui-monospace, monospace" },
          '.cm-content': { minHeight: '400px', padding: '12px 0' },
          '.cm-gutters': { backgroundColor: '#f3f4ef', borderRight: '1px solid #e0e2da' },
          '&.cm-focused': { outline: 'none' },
        }),
      ],
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [ariaLabel])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  const format = () => {
    if (issue) return
    onChange(formatJSON(value))
  }

  return (
    <div className="json-editor-shell">
      <div className="json-editor-bar">
        <span className={issue ? 'invalid' : 'valid'}>
          {issue ? <CircleAlert size={13} /> : <CheckCircle2 size={13} />}
          {issue || 'Valid JSON'}
        </span>
        <button type="button" onClick={format} disabled={Boolean(issue)}>
          <Braces size={13} /> Format
        </button>
      </div>
      <div className="json-editor-host" ref={hostRef} />
    </div>
  )
}
