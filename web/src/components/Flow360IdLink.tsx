import type { ReactNode } from 'react'
import { buildFlow360ProjectUrl, buildFlow360ResourceUrl } from '../lib/flow360Urls'

type Props = {
  environment?: string
  projectId: string
  resourceId?: string
  resourceType?: string
  children?: ReactNode
  className?: string
  title?: string
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
}

export default function Flow360IdLink({
  environment,
  projectId,
  resourceId,
  resourceType,
  children,
  className = '',
  title,
  onClick,
}: Props) {
  const isResource = Boolean(resourceId && resourceType)
  const id = isResource ? resourceId! : projectId
  const url = isResource
    ? buildFlow360ResourceUrl(environment, projectId, resourceId!, resourceType!)
    : buildFlow360ProjectUrl(environment, projectId)

  return (
    <a
      className={`id-link ${className}`.trim()}
      href={url}
      target="_blank"
      rel="noreferrer"
      title={title ?? `Open ${isResource ? resourceType : 'Project'} in Flow360 workbench`}
      onClick={onClick}
    >
      {children ?? id}
    </a>
  )
}
