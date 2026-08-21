import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InputField, ToggleField } from './InputField'

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

    expect(markup).toContain('class="input-field input-field--invalid"')
    expect(markup).toContain('operating_condition.mach')
    expect(markup).toContain('Not configured')
    expect(markup).toContain('Mach must be positive.')
    expect(markup).toContain('role="alert"')
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
})
