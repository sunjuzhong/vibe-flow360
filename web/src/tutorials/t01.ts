import baselineDocument from '../../../tutorials/T01-first-lift-drag/simulation.json'
import alphaFivePatch from '../../../tutorials/T01-first-lift-drag/variants/alpha-5deg.patch.json'

export type TutorialStep = {
  id: string
  label: string
  title: string
  summary: string
}

export type SetupCheck = {
  id: string
  label: string
  detail: string
  passed: boolean
}

export const t01Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the question', summary: 'Start from the engineering decision, not the solver.' },
  { id: 'geometry', label: '02', title: 'Understand the geometry', summary: 'Confirm units and assign physical meaning to surfaces.' },
  { id: 'setup', label: '03', title: 'Review the setup', summary: 'Connect mesh, physics, reference values, and outputs.' },
  { id: 'variant', label: '04', title: 'Try a variant', summary: 'Change only angle of attack and inspect the semantic diff.' },
  { id: 'evidence', label: '05', title: 'Define trustworthy evidence', summary: 'Separate a completed run from a credible result.' },
  { id: 'run', label: '06', title: 'Continue to Flow360', summary: 'Review the paid boundary before creating a cloud run.' },
]

export const t01Baseline = baselineDocument as unknown as Record<string, unknown>
export const t01AlphaFivePatch = alphaFivePatch as unknown as Record<string, unknown>

export const t01ParameterCards = [
  { label: 'Velocity', value: '100 m/s', provenance: 'provided', why: 'Defines the flight condition and dynamic pressure.' },
  { label: 'Angle of attack', value: '0° baseline · 5° variant', provenance: 'provided', why: 'The single controlled difference between the two cases.' },
  { label: 'Reference area', value: '24 m²', provenance: 'derived', why: 'Normalizes force into CL and CD; a wrong value makes coefficients misleading.' },
  { label: 'Reference length', value: '2.4 m', provenance: 'derived', why: 'Defines the moment normalization used for aerodynamic reporting.' },
  { label: 'Farfield size', value: '50 geometry lengths', provenance: 'inferred', why: 'Keeps the outer boundary away from the aircraft disturbance.' },
  { label: 'First layer', value: '1 mm', provenance: 'inferred', why: 'Makes the wall-normal mesh assumption explicit for y+ review.' },
]

export const t01Evidence = [
  { title: 'Mesh reviewed', detail: 'No open boundaries, missing layers, or unacceptable local quality.' },
  { title: 'Residual reduction', detail: 'Primary residuals fall by at least three orders of magnitude.' },
  { title: 'Force stability', detail: 'CL and CD change by less than 1% over the final 200 pseudo-steps.' },
  { title: 'Surface fields', detail: 'Cp, Cf, yPlus, and CfVec are present and reviewable.' },
]

export function mergeTutorialPatch(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const base = target && typeof target === 'object' && !Array.isArray(target)
    ? { ...(target as Record<string, unknown>) }
    : {}
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete base[key]
    else base[key] = mergeTutorialPatch(base[key], value)
  }
  return base
}

export function t01ParamsForAlpha(alpha: 0 | 5): Record<string, unknown> {
  if (alpha === 0) return t01Baseline
  return mergeTutorialPatch(t01Baseline, t01AlphaFivePatch) as Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function validateT01Setup(params: Record<string, unknown>): SetupCheck[] {
  const units = record(params.unit_system)
  const condition = record(params.operating_condition)
  const alpha = record(condition.alpha)
  const meshing = record(params.meshing)
  const models = Array.isArray(params.models) ? params.models.map(record) : []
  const outputs = Array.isArray(params.outputs) ? params.outputs.map(record) : []
  const outputFields = outputs.flatMap((output) => {
    const fields = record(output.output_fields)
    return Array.isArray(fields.items) ? fields.items : []
  })

  return [
    {
      id: 'version',
      label: 'Pinned Flow360 schema',
      detail: `SimulationParams ${String(params.version || 'missing')} · tutorial package 25.10.3`,
      passed: String(params.version || '').startsWith('25.10.'),
    },
    {
      id: 'units',
      label: 'Explicit SI units',
      detail: 'Geometry and reference quantities are interpreted in metres.',
      passed: units.name === 'SI',
    },
    {
      id: 'condition',
      label: 'Flight condition is complete',
      detail: `100 m/s · α ${String(alpha.value)}° · β 0°`,
      passed: record(condition.velocity_magnitude).value === 100 && (alpha.value === 0 || alpha.value === 5),
    },
    {
      id: 'mesh',
      label: 'Meshing intent is explicit',
      detail: 'Automated farfield and visible surface/boundary-layer defaults.',
      passed: Array.isArray(meshing.volume_zones) && meshing.volume_zones.length > 0,
    },
    {
      id: 'physics',
      label: 'Boundary semantics are assigned',
      detail: 'Fluid, aircraft Wall, and Freestream models are all present.',
      passed: ['Fluid', 'Wall', 'Freestream'].every((type) => models.some((model) => model.type === type)),
    },
    {
      id: 'outputs',
      label: 'Decision outputs are requested',
      detail: 'CL, CD, Cp, Cf, yPlus, and CfVec are included.',
      passed: ['CL', 'CD', 'Cp', 'Cf', 'yPlus', 'CfVec'].every((field) => outputFields.includes(field)),
    },
  ]
}

export function tutorialProgress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t01Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t01Steps.length) * 100)
}
