import { CircleHelp } from 'lucide-react'
import { useId, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  label?: string
  placement?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
  width?: 'default' | 'wide' | 'guide'
}

export default function HelpTooltip({
  children,
  label = 'Show help',
  placement = 'bottom',
  align = 'center',
  width = 'default',
}: Props) {
  const tooltipId = useId()

  return (
    <span className={`help-tooltip help-tooltip--${placement} help-tooltip--${align} help-tooltip--${width}`}>
      <button
        type="button"
        className="help-tooltip__trigger"
        aria-label={label}
        aria-describedby={tooltipId}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <CircleHelp size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <span className="help-tooltip__content" id={tooltipId} role="tooltip">
        {children}
      </span>
    </span>
  )
}
