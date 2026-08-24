import { AlertCircle, CheckCircle2, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

export type FieldState = 'neutral' | 'error' | 'warning' | 'success'

export type FieldMessage = {
  key?: string
  level?: Exclude<FieldState, 'neutral'>
  message: string
}

export type FieldControlProps = {
  id: string
  disabled?: boolean
  required?: boolean
  'aria-required'?: true
  'aria-invalid'?: true
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-errormessage'?: string
}

export type FieldShellProps = {
  id: string
  label: ReactNode
  children: ReactNode | ((controlProps: FieldControlProps) => ReactNode)
  required?: boolean
  disabled?: boolean
  help?: ReactNode
  description?: ReactNode
  path?: string
  status?: ReactNode
  statusTone?: FieldState
  messages?: FieldMessage[]
  hideLabel?: boolean
  className?: string
  controlClassName?: string
}

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ')
}

function messageIcon(level: FieldMessage['level']) {
  if (level === 'success') return <CheckCircle2 size={13} />
  if (level === 'warning') return <TriangleAlert size={13} />
  return <AlertCircle size={13} />
}

/**
 * Shared presentation and accessibility contract for every schema-driven field.
 * Controls receive the generated ARIA wiring through the render callback so
 * composite editors can choose the correct focusable element.
 */
export function FieldShell({
  id,
  label,
  children,
  required = false,
  disabled = false,
  help,
  description,
  path,
  status,
  statusTone = 'neutral',
  messages = [],
  hideLabel = false,
  className,
  controlClassName,
}: FieldShellProps) {
  const errorMessages = messages.filter((message) => (message.level ?? 'error') === 'error')
  const effectiveTone: FieldState = errorMessages.length
    ? 'error'
    : messages.some((message) => message.level === 'warning')
      ? 'warning'
      : messages.some((message) => message.level === 'success')
        ? 'success'
        : statusTone
  const descriptionIDs = [
    help && !hideLabel ? `${id}-help` : '',
    description ? `${id}-description` : '',
    status && !hideLabel ? `${id}-status` : '',
    ...messages.map((_, index) => `${id}-message-${index}`),
  ].filter(Boolean)
  const errorID = errorMessages.length
    ? `${id}-message-${messages.indexOf(errorMessages[0])}`
    : undefined
  const controlProps: FieldControlProps = {
    id,
    disabled: disabled || undefined,
    required: required || undefined,
    'aria-required': required || undefined,
    'aria-invalid': errorMessages.length ? true : undefined,
    'aria-label': hideLabel && typeof label === 'string' ? label : undefined,
    'aria-describedby': descriptionIDs.length ? descriptionIDs.join(' ') : undefined,
    'aria-errormessage': errorID,
  }

  return (
    <div
      className={classes(
        'field-shell',
        `field-shell--${effectiveTone}`,
        disabled && 'field-shell--disabled',
        className,
      )}
      data-field-path={path}
      aria-disabled={disabled || undefined}
    >
      <label className="field-shell__label-wrap input-field__label-wrap" htmlFor={id}>
        <span className="field-shell__label input-field__label">
          {!hideLabel && (
            <span className="field-shell__title-row input-field__title-row">
              <strong>
                {label}
                {required ? <span className="field-shell__required input-field__required" aria-hidden="true">*</span> : null}
              </strong>
              {help ? <span id={`${id}-help`} className="field-shell__help">{help}</span> : null}
              {status ? <small id={`${id}-status`} className={classes('field-shell__status', 'input-field__status', `field-shell__status--${statusTone}`)}>{status}</small> : null}
            </span>
          )}
          {path ? <code>{path}</code> : null}
          {description ? <small id={`${id}-description`} className="field-shell__description input-field__description">{description}</small> : null}
        </span>
      </label>
      <div className={classes('field-shell__control', controlClassName)}>
        {typeof children === 'function' ? children(controlProps) : children}
      </div>
      {messages.length ? (
        <div className="field-shell__messages input-field__errors">
          {messages.map((message, index) => {
            const level = message.level ?? 'error'
            return (
              <small
                id={`${id}-message-${index}`}
                className={`field-shell__message field-shell__message--${level}`}
                role={level === 'error' ? 'alert' : 'status'}
                key={message.key ?? `${message.message}-${index}`}
              >
                {messageIcon(level)}{message.message}
              </small>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
