import { CheckCircle2, CircleDashed, TriangleAlert } from 'lucide-react'
import type { VolumeCapability } from '../../lib/volumeMeshReview'

export function VolumeCapabilityPanel({ capabilities }: { capabilities: VolumeCapability[] }) {
  return (
    <details className="volume-capability-panel">
      <summary>Diagnostic data coverage <span>{capabilities.filter((item) => item.status === 'available').length}/{capabilities.length}</span></summary>
      <div>
        {capabilities.map((capability) => (
          <div className={capability.status} key={capability.key}>
            {capability.status === 'available' ? <CheckCircle2 size={13} /> : capability.status === 'proxy' ? <TriangleAlert size={13} /> : <CircleDashed size={13} />}
            <span><strong>{capability.label}</strong><small>{capability.detail}</small></span>
          </div>
        ))}
      </div>
    </details>
  )
}
