import type { ReactNode } from 'react'
import { AlertCircle, Check } from 'lucide-react'

export type InputFieldError = {
  key?: string
  message: string
}

type FieldCopy = {
  label: ReactNode
  path?: string
  description?: ReactNode
  help?: ReactNode
  required?: boolean
  status?: ReactNode
  hideLabel?: boolean
}

type InputFieldProps = FieldCopy & {
  id?: string
  children: ReactNode
  errors?: InputFieldError[]
  className?: string
  controlClassName?: string
}

type ToggleFieldProps = FieldCopy & {
  checked: boolean
  onChange: (checked: boolean) => void
  checkedLabel?: ReactNode
  uncheckedLabel?: ReactNode
  errors?: InputFieldError[]
  className?: string
}

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function InputFieldLabel({ label, path, description, help, required, status, hideLabel = false }: FieldCopy) {
  return (
    <span className="input-field__label">
      {!hideLabel && (
        <span className="input-field__title-row">
          <strong>{label}{required ? <span className="input-field__required" aria-hidden="true">*</span> : null}</strong>
          {help}
          {status ? <small className="input-field__status">{status}</small> : null}
        </span>
      )}
      {path ? <code>{path}</code> : null}
      {description ? <small className="input-field__description">{description}</small> : null}
    </span>
  )
}

export function InputFieldErrors({ errors = [] }: { errors?: InputFieldError[] }) {
  if (!errors.length) return null
  return (
    <span className="input-field__errors">
      {errors.map((error, index) => (
        <small role="alert" key={error.key ?? `${error.message}-${index}`}>
          <AlertCircle size={13} />{error.message}
        </small>
      ))}
    </span>
  )
}

export function InputField({ id, children, errors = [], className, controlClassName, ...copy }: InputFieldProps) {
  return (
    <div className={classes('input-field', errors.length > 0 && 'input-field--invalid', className)}>
      <label className="input-field__label-wrap" htmlFor={id}><InputFieldLabel {...copy} /></label>
      <span className={classes('input-field__control', controlClassName)}>{children}</span>
      <InputFieldErrors errors={errors} />
    </div>
  )
}

export function ToggleField({ checked, onChange, checkedLabel, uncheckedLabel, errors = [], className, ...copy }: ToggleFieldProps) {
  const accessibleLabel = typeof copy.label === 'string' ? copy.label : undefined
  const stateLabel = checked ? checkedLabel : uncheckedLabel
  return (
    <div className={classes('input-field', 'input-field--toggle', errors.length > 0 && 'input-field--invalid', className)}>
      <InputFieldLabel {...copy} />
      <label className="input-field__toggle-control">
        <input type="checkbox" aria-label={accessibleLabel} checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span aria-hidden="true"><Check size={14} /></span>
        {stateLabel ? <small>{stateLabel}</small> : null}
      </label>
      <InputFieldErrors errors={errors} />
    </div>
  )
}
