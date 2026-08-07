import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  label: string
  children: ReactNode
}

export default function InspectorDisclosure({ label, children }: Props) {
  return (
    <details className="inspector-section inspector-disclosure">
      <summary>
        <span className="eyebrow">{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      {children}
    </details>
  )
}
