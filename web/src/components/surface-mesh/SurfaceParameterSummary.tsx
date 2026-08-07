import type { SurfaceParameterRow } from '../../lib/surfaceMeshReview'

export function SurfaceParameterSummary({
  parameters,
  defaultOpen = false,
}: {
  parameters: SurfaceParameterRow[]
  defaultOpen?: boolean
}) {
  return (
    <details className="surface-parameter-summary" open={defaultOpen}>
      <summary>Surface meshing parameters <span>{parameters.length}</span></summary>
      <dl>
        {parameters.map((parameter) => (
          <div key={parameter.path}>
            <dt title={parameter.path}>{parameter.label}</dt>
            <dd>{parameter.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
