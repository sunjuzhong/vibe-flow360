import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Flow360ConfirmationDialog from './Flow360ConfirmationDialog'

describe('Flow360ConfirmationDialog', () => {
  it('renders an accessible review boundary with explicit safe and billable actions', () => {
    const markup = renderToStaticMarkup(
      <Flow360ConfirmationDialog
        open
        eyebrow="Flow360 · Remote execution"
        title="Submit the approved plan?"
        description="Only the reviewed plan will be submitted."
        targetLabel="Approved simulation plan"
        targetName="ddd · Surface Mesh"
        details={[
          { label: 'Source', value: 'Geometry · ddd' },
          { label: 'Run up to', value: 'Surface Mesh' },
        ]}
        risk="Flow360 may create billable cloud resources."
        confirmLabel="Submit approved plan"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('ddd · Surface Mesh')
    expect(markup).toContain('Cloud billing boundary')
    expect(markup).toContain('Back to review')
    expect(markup).toContain('Submit approved plan')
  })

  it('renders nothing while closed', () => {
    const markup = renderToStaticMarkup(
      <Flow360ConfirmationDialog
        open={false}
        eyebrow=""
        title=""
        description=""
        targetLabel=""
        targetName=""
        details={[]}
        risk=""
        confirmLabel=""
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(markup).toBe('')
  })
})
