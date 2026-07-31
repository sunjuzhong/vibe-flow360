import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  label: string
  accessibleLabel?: string
  icon: ReactNode
}

export function ProjectShellAction({
  label,
  accessibleLabel = label,
  icon,
  title,
  type = 'button',
  ...buttonProps
}: Props) {
  return (
    <button
      {...buttonProps}
      type={type}
      aria-label={accessibleLabel}
      title={title ?? accessibleLabel}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
