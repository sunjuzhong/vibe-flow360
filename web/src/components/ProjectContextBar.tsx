import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProjectItem, ResourceNode } from '../api/client'
import Flow360IdLink from './Flow360IdLink'

type StageLink = { stage: string; resource?: ProjectItem | ResourceNode; available?: boolean }

type Props = {
  resourceName: string
  resourceType: string
  resourceId: string
  environment?: string
  projectId: string
  status: string
  stages: string[]
  selectedStage: number
  stageLinks?: StageLink[]
  onStageSelect?: (link: StageLink) => void
  resourceIcon: ReactNode
  draftControls: ReactNode
}

export default function ProjectContextBar({
  resourceName,
  resourceType,
  resourceId,
  environment,
  projectId,
  status,
  stages,
  selectedStage,
  stageLinks,
  onStageSelect,
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
            <Flow360IdLink environment={environment} projectId={projectId} resourceId={resourceId} resourceType={resourceType} />
          </small>
        </div>
        <em className={`status-pill status-${status.toLowerCase()}`}>{status}</em>
      </div>

      <div className="resource-stage-strip canvas-stage-strip" aria-label="Simulation stages" style={{ gridTemplateColumns: `repeat(${Math.max(1, stages.length)}, minmax(0, 1fr))` }}>
        {stages.map((stage, index) => {
          const link = stageLinks?.find((item) => item.stage === stage)
          const linked = link?.resource
          const available = Boolean(linked && link?.available !== false)
          const className = [index === selectedStage ? 'current' : '', index < selectedStage ? 'before' : '', available ? 'clickable' : 'disabled'].filter(Boolean).join(' ')
          const content = <><span>{index < selectedStage ? <CheckCircle2 size={13} /> : index + 1}</span><small>{stage.replace('Mesh', ' Mesh')}</small></>
          return available && linked && onStageSelect ? (
            <button type="button" className={className} key={stage} onClick={() => onStageSelect({ stage, resource: linked, available })} aria-current={index === selectedStage ? 'step' : undefined}>
              {content}
            </button>
          ) : (
            <div className={className} key={stage} aria-disabled="true">
              {content}
            </div>
          )
        })}
      </div>

      <div className="project-context-draft">{draftControls}</div>
    </section>
  )
}
