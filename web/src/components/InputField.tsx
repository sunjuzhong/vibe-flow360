import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { FieldShell, type FieldControlProps, type FieldMessage, type FieldShellProps } from './FieldShell'

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
  messages?: FieldMessage[]
  className?: string
  controlClassName?: string
  disabled?: boolean
}

type ToggleFieldProps = FieldCopy & {
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  checkedLabel?: ReactNode
  uncheckedLabel?: ReactNode
  errors?: InputFieldError[]
  messages?: FieldMessage[]
  className?: string
  disabled?: boolean
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

function fieldMessages(errors: InputFieldError[]): FieldMessage[] {
  return errors.map((error) => ({ ...error, level: 'error' }))
}

function enhanceControl(children: ReactNode, controlProps: FieldControlProps) {
  const child = Children.only(children)
  if (!isValidElement(child)) return child
  return cloneElement(child as ReactElement<Record<string, unknown>>, controlProps)
}

export function InputField({ id = 'field', children, errors = [], messages = [], className, controlClassName, disabled, ...copy }: InputFieldProps) {
  const allMessages = [...messages, ...fieldMessages(errors)]
  return (
    <FieldShell
      id={id}
      label={copy.label}
      path={copy.path}
      description={copy.description}
      help={copy.help}
      required={copy.required}
      status={copy.status}
      hideLabel={copy.hideLabel}
      disabled={disabled}
      messages={allMessages}
      className={classes('input-field', allMessages.some((message) => (message.level ?? 'error') === 'error') && 'input-field--invalid', className)}
      controlClassName={classes('input-field__control', controlClassName)}
    >
      {(controlProps) => enhanceControl(children, controlProps)}
    </FieldShell>
  )
}

export function ToggleField({ id = 'toggle-field', checked, onChange, checkedLabel, uncheckedLabel, errors = [], messages = [], className, disabled, ...copy }: ToggleFieldProps) {
  const accessibleLabel = typeof copy.label === 'string' ? copy.label : undefined
  const stateLabel = checked ? checkedLabel : uncheckedLabel
  const allMessages = [...messages, ...fieldMessages(errors)]
  return (
    <FieldShell
      id={id}
      label={copy.label}
      path={copy.path}
      description={copy.description}
      help={copy.help}
      required={copy.required}
      status={copy.status}
      hideLabel={copy.hideLabel}
      disabled={disabled}
      messages={allMessages}
      className={classes('input-field', 'input-field--toggle', allMessages.some((message) => (message.level ?? 'error') === 'error') && 'input-field--invalid', className)}
    >
      {(controlProps) => (
        <label className="input-field__toggle-control">
          <input {...controlProps} type="checkbox" aria-label={accessibleLabel} checked={checked} onChange={(event) => onChange(event.target.checked)} />
          <span aria-hidden="true"><Check size={14} /></span>
          {stateLabel ? <small>{stateLabel}</small> : null}
        </label>
      )}
    </FieldShell>
  )
}

export { FieldShell }
export type { FieldControlProps, FieldMessage, FieldShellProps }
