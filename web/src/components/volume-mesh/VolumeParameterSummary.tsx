import type { VolumeParameterRow } from '../../lib/volumeMeshReview'

export function VolumeParameterSummary({ parameters }: { parameters: VolumeParameterRow[] }) {
  const sections = Array.from(new Set(parameters.map((parameter) => parameter.section)))
  return (
    <details className="volume-parameter-summary">
      <summary>Volume meshing parameters <span>{parameters.length}</span></summary>
      {sections.map((section) => (
        <section key={section}>
          <strong>{section}</strong>
          <dl>
            {parameters.filter((parameter) => parameter.section === section).map((parameter) => (
              <div key={parameter.path}>
                <dt title={parameter.path}>{parameter.label}</dt>
                <dd>{parameter.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </details>
  )
}
