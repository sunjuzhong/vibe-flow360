const flow360DomainMap: Record<string, string> = {
  dev: 'flow360.dev-simulation.cloud',
  development: 'flow360.dev-simulation.cloud',
  uat: 'flow360.uat-simulation.cloud',
  prod: 'flow360.simulation.cloud',
  production: 'flow360.simulation.cloud',
}

export function getFlow360Domain(environment?: string): string {
  const key = (environment || 'prod').toLowerCase().trim()
  return flow360DomainMap[key] ?? flow360DomainMap.prod
}

export function buildFlow360ProjectUrl(environment: string | undefined, projectId: string): string {
  return `https://${getFlow360Domain(environment)}/workbench/${encodeURIComponent(projectId)}`
}

export function buildFlow360ResourceUrl(
  environment: string | undefined,
  projectId: string,
  resourceId: string,
  resourceType: string,
): string {
  const query = new URLSearchParams({ id: resourceId, type: resourceType })
  return `${buildFlow360ProjectUrl(environment, projectId)}?${query.toString()}`
}
