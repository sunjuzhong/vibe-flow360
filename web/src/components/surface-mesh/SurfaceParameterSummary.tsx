import type { SurfaceParameterRow } from '../../lib/surfaceMeshReview'

export function SurfaceParameterSummary({ parameters }: { parameters: SurfaceParameterRow[] }) {
  return (
    <details className="surface-parameter-summary">
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
