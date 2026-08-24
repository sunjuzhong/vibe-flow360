import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FieldShell, InputField, ToggleField } from './InputField'

describe('InputField', () => {
  it('renders reusable engineering metadata, control state, and errors', () => {
    const markup = renderToStaticMarkup(
      <InputField
        id="mach"
        label="Mach number"
        path="operating_condition.mach"
        description="Freestream Mach number."
        required
        status="Not configured"
        errors={[{ key: 'mach', message: 'Mach must be positive.' }]}
      >
        <input id="mach" type="number" defaultValue="-1" />
      </InputField>,
    )

    expect(markup).toContain('field-shell--error')
    expect(markup).toContain('input-field--invalid')
    expect(markup).toContain('operating_condition.mach')
    expect(markup).toContain('Not configured')
    expect(markup).toContain('Mach must be positive.')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-describedby="mach-description mach-status mach-message-0"')
    expect(markup).toContain('aria-errormessage="mach-message-0"')
  })

  it('renders an accessible boolean control with an explicit state label', () => {
    const markup = renderToStaticMarkup(
      <ToggleField label="Low Mach preconditioner" path="models.low_mach" checked checkedLabel="Enabled" uncheckedLabel="Disabled" onChange={() => undefined} />,
    )

    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('aria-label="Low Mach preconditioner"')
    expect(markup).toContain('checked=""')
    expect(markup).toContain('Enabled')
  })

  it('wires disabled, warning, and success states through the shared shell contract', () => {
    const warning = renderToStaticMarkup(
      <FieldShell
        id="reynolds"
        label="Reynolds number"
        path="operating_condition.reynolds"
        disabled
        required
        status="Review"
        statusTone="warning"
        messages={[{ level: 'warning', message: 'Confirm the reference length.' }]}
      >
        {(controlProps) => <input {...controlProps} type="number" />}
      </FieldShell>,
    )
    expect(warning).toContain('field-shell--warning')
    expect(warning).toContain('field-shell--disabled')
    expect(warning).toContain('disabled=""')
    expect(warning).toContain('aria-required="true"')
    expect(warning).toContain('role="status"')
    expect(warning).not.toContain('aria-invalid')

    const success = renderToStaticMarkup(
      <FieldShell id="validated" label="Validated value" status="Validated" statusTone="success">
        {(controlProps) => <input {...controlProps} />}
      </FieldShell>,
    )
    expect(success).toContain('field-shell--success')
    expect(success).toContain('field-shell__status--success')
  })
})
