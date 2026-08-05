import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  resourceName: string
  resourceType: string
  resourceId: string
  resourceUrl: string
  status: string
  stages: string[]
  selectedStage: number
  resourceIcon: ReactNode
  draftControls: ReactNode
}

export default function ProjectContextBar({
  resourceName,
  resourceType,
  resourceId,
  resourceUrl,
  status,
  stages,
  selectedStage,
  resourceIcon,
  draftControls,
}: Props) {
  return (
    <section className="project-context-bar" aria-label="Project resource context">
      <div className="canvas-resource-title">
        <span className={`resource-type-icon type-${resourceType.toLowerCase()}`}>
          {resourceIcon}
        </span>
        <div>
          <strong>{resourceName}</strong>
          <small>
            {resourceType} ·{' '}
            <a
              className="id-link"
              href={resourceUrl}
              target="_blank"
              rel="noreferrer"
              title="Open in Flow360 workbench"
            >
              {resourceId}
            </a>
          </small>
        </div>
        <em className={`status-pill status-${status.toLowerCase()}`}>{status}</em>
      </div>

      <div className="resource-stage-strip canvas-stage-strip" aria-label="Simulation stages">
        {stages.map((stage, index) => (
          <div className={`${index === selectedStage ? 'current' : ''} ${index < selectedStage ? 'before' : ''}`} key={stage}>
            <span>{index < selectedStage ? <CheckCircle2 size={13} /> : index + 1}</span>
            <small>{stage.replace('Mesh', ' Mesh')}</small>
          </div>
        ))}
      </div>

      <div className="project-context-draft">{draftControls}</div>
    </section>
  )
}
