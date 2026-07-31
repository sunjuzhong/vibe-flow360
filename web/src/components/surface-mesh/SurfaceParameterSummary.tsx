import type { SurfaceParameterRow } from '../../lib/surfaceMeshReview'

export function SurfaceParameterSummary({ parameters }: { parameters: SurfaceParameterRow[] }) {
  return (
    <details className="surface-parameter-summary">
      <summary>Surface meshing parameters <span>{parameters.length}</span></summary>
      {parameters.length > 0 ? (
        <dl>
          {parameters.map((parameter) => (
            <div key={parameter.path}>
              <dt title={parameter.path}>{parameter.label}</dt>
              <dd>{parameter.value}</dd>
            </div>
          ))}
        </dl>
      ) : <p>No SurfaceMesh-specific parameters were found.</p>}
    </details>
  )
}
