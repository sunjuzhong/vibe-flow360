import type {
  AgentAction,
  GeometryComparison,
  GeometryDiagnosticCapability,
  GeometryDiagnosticFinding,
  GeometryDiagnosticReport,
  ProjectInfo,
} from '../api/client'

type Translate = (value: string) => string

const capabilityLabels: Record<string, string> = {
  'topology-analysis': 'Topology analysis',
  'small-features': 'Small features',
  'gap-analysis': 'Gap analysis',
  'curvature-analysis': 'Curvature analysis',
  'proximity-analysis': 'Proximity analysis',
  'exact-cad-clearance': 'Exact CAD clearance',
}

const capabilityDetails: Record<string, string> = {
  'topology-analysis:available': 'Computed from synchronized indexed triangles using edge incidence, connectivity, and bounded self-intersection tests.',
  'topology-analysis:partial': 'Edge incidence and connectivity were computed, but self-intersection analysis is incomplete.',
  'topology-analysis:unavailable': 'Compatible synchronized position and index buffers are unavailable.',
  'small-features:available': 'Uses Flow360-provided CAD face areas and the selected relative threshold.',
  'small-features:proxy': 'Uses the triangle-count distribution as a proxy, not physical feature size.',
  'gap-analysis:proxy': 'Uses solid bounding-box separation as a lower-bound proxy, not an exact gap.',
  'gap-analysis:unavailable': 'Multiple bounded solids are required for a gap proxy.',
  'curvature-analysis:proxy': 'Uses maximum tessellation-normal variation per Face, not CAD curvature radius.',
  'curvature-analysis:unavailable': 'Compatible tessellation-normal buffers are unavailable.',
  'proximity-analysis:proxy': 'Uses solid bounding-box separation as a lower-bound proxy, not exact clearance.',
  'proximity-analysis:unavailable': 'Multiple bounded solids are required for a proximity proxy.',
  'exact-cad-clearance:unavailable': 'UVF has no CAD B-rep or exact distance-query evidence.',
}

const findingCopy: Record<string, { title: string; detail: string; recommendation: string }> = {
  'high-normal-variation': {
    title: 'High normal-variation surfaces',
    detail: 'These tessellated surfaces exceed the selected face-normal variation threshold.',
    recommendation: 'Inspect them in 3D and confirm whether curvature-sensitive surface refinement is required.',
  },
  'curvature-analysis-unavailable': {
    title: 'Curvature analysis unavailable',
    detail: 'No compatible tessellated-normal evidence is available.',
    recommendation: 'Treat curvature refinement as an engineering input until supported evidence is available.',
  },
  'gap-analysis-unavailable': {
    title: 'Gap analysis unavailable',
    detail: 'The synchronized visualization evidence does not contain a multi-body distance result.',
    recommendation: 'Use a CAD-kernel or mesher-supported gap diagnostic before applying a gap tolerance.',
  },
  'proximity-analysis-unavailable': {
    title: 'Proximity analysis unavailable',
    detail: 'Multiple bounded solids are required for the AABB proximity proxy.',
    recommendation: 'Do not infer close-body clearances from the rendered view alone.',
  },
  'body-proximity-proxy': {
    title: 'Solid proximity lower bound',
    detail: 'The closest solid bounding boxes define only a lower-bound distance; overlapping boxes remain inconclusive.',
    recommendation: 'Inspect the implicated bodies and confirm clearance with a CAD-kernel or mesher-supported distance calculation.',
  },
  'topology-free-edges': {
    title: 'Open / free edges',
    detail: 'One or more quantized edges belong to only one triangle.',
    recommendation: 'Locate the affected surfaces and repair or re-export the CAD topology before volume meshing.',
  },
  'topology-non-manifold': {
    title: 'Non-manifold edges',
    detail: 'One or more quantized edges are shared by more than two triangles.',
    recommendation: 'Locate the affected surfaces and repair or re-export the CAD topology before volume meshing.',
  },
  'topology-self-intersections': {
    title: 'Self-intersections',
    detail: 'Non-adjacent tessellated triangles intersect, or the bounded intersection check could not finish.',
    recommendation: 'Locate the affected surfaces and repair or re-export the CAD topology before volume meshing.',
  },
  'topology-components': {
    title: 'Disconnected components',
    detail: 'The tessellation contains multiple edge-connected components.',
    recommendation: 'Review whether multiple disconnected bodies are intended for this CFD workflow.',
  },
}

export function localizeDiagnosticCapability(capability: GeometryDiagnosticCapability, t: Translate) {
  return {
    label: t(capabilityLabels[capability.key] ?? capability.key.replaceAll('-', ' ')),
    status: t(capability.status),
    detail: t(capabilityDetails[`${capability.key}:${capability.status}`] ?? capability.detail),
  }
}

export function localizeDiagnosticFinding(finding: GeometryDiagnosticFinding, t: Translate) {
  const smallArea = finding.id === 'small-surface-proxy' && finding.evidence_keys?.includes('median_surface_area')
  const smallTriangles = finding.id === 'small-surface-proxy' && !smallArea
  const copy = smallArea ? {
    title: 'Small-area surfaces need review',
    detail: 'These surfaces fall below the selected fraction of the median provided face area.',
    recommendation: 'Focus the candidates in 3D and confirm physical dimensions before suppressing or refining them.',
  } : smallTriangles ? {
    title: 'Low-triangle surfaces need review',
    detail: 'These surfaces are statistical tessellation outliers, not confirmed small physical features.',
    recommendation: 'Focus the candidates in 3D and confirm physical dimensions before suppressing or refining them.',
  } : findingCopy[finding.id]

  return {
    title: t(copy?.title ?? finding.title),
    detail: t(copy?.detail ?? finding.detail),
    recommendation: finding.recommendation ? t(copy?.recommendation ?? finding.recommendation) : '',
  }
}

export type GeometryReviewTemplateId = 'aircraft' | 'automotive' | 'rotating-machinery' | 'thermal'

export const geometryReviewTemplates: Array<{
  id: GeometryReviewTemplateId
  label: string
  checks: string[]
}> = [
  {
    id: 'aircraft',
    label: 'Aircraft',
    checks: ['Closed wetted surface', 'Farfield and symmetry intent', 'Trailing-edge and control-gap resolution'],
  },
  {
    id: 'automotive',
    label: 'Automotive',
    checks: ['Ground and wheel roles', 'Underbody clearance', 'Cooling-path openings and wake features'],
  },
  {
    id: 'rotating-machinery',
    label: 'Rotating machinery',
    checks: ['Rotating/stationary grouping', 'Periodic or sliding interfaces', 'Tip and seal clearances'],
  },
  {
    id: 'thermal',
    label: 'Thermal / CHT',
    checks: ['Solid/fluid ownership', 'Contact and interface pairing', 'Thin solids and heat-transfer surfaces'],
  },
]

export function geometryDiagnosticAgentAction({
  project,
  geometryId,
  geometryName,
  report,
  comparison,
  templateId,
}: {
  project: ProjectInfo
  geometryId: string
  geometryName: string
  report: GeometryDiagnosticReport
  comparison: GeometryComparison | null
  templateId: GeometryReviewTemplateId
}): AgentAction {
  const template = geometryReviewTemplates.find((item) => item.id === templateId) ?? geometryReviewTemplates[0]
  const actionableFindings = report.findings.filter((finding) => (finding.entity_ids?.length ?? 0) > 0)
  const unavailableCapabilities = report.capabilities
    .filter((item) => item.status === 'unavailable')
    .map((item) => item.key)
  return {
    version: 'v1',
    kind: 'create-plan',
    message: 'Create an evidence-backed advanced Geometry review plan.',
    proposals: [{
      id: `geometry-diagnostics-${Date.now()}`,
      project_id: project.id,
      project_name: project.name,
      source_id: geometryId,
      source_type: 'Geometry',
      source_name: geometryName,
      action: 'Geometry',
      target: 'surface-mesh',
      name: `Advanced Geometry review for ${geometryName}`,
      intent: `Review server-backed Geometry evidence using the ${template.label} checklist before SurfaceMesh planning.`,
      patch: {},
      branch_preview: `${geometryName} → advanced diagnostics → Surface Mesh`,
      fields: [
        {
          key: 'geometry_diagnostic_source',
          value: {
            schemaVersion: report.schema_version,
            fingerprint: report.fingerprint,
            settings: report.settings,
          },
          provenance: 'provided',
          description: 'Immutable server-backed diagnostic source and tolerance settings.',
        },
        {
          key: 'geometry_diagnostic_evidence',
          value: report.evidence,
          provenance: 'derived',
          description: 'Measurements computed from the synchronized Flow360 UVF manifest.',
        },
        {
          key: 'geometry_diagnostic_findings',
          value: report.findings,
          provenance: 'derived',
          description: 'Findings preserve unknown and unavailable states instead of inventing results.',
        },
        {
          key: 'geometry_grouping_proposals',
          value: report.grouping_proposals,
          provenance: 'inferred',
          description: 'Generated-name grouping proposals that require engineering review.',
        },
        {
          key: 'domain_review_template',
          value: template,
          provenance: 'provided',
          description: 'User-selected domain checklist; checklist items are not diagnostic results.',
        },
        ...(comparison ? [{
          key: 'geometry_version_comparison',
          value: comparison,
          provenance: 'derived' as const,
          description: 'Server-side comparison of synchronized Geometry visualization manifests.',
        }] : []),
      ],
      validation_hints: [
        ...template.checks,
        'Confirm every inferred grouping and every proxy finding in 3D before changing Geometry or meshing settings',
        `Do not treat unavailable diagnostic checks as passed: ${unavailableCapabilities.join(', ') || 'none'}`,
      ],
    }],
    assumptions: actionableFindings.length > 0
      ? ['Diagnostic candidates retain their reported evidence method and still require 3D engineering review.']
      : [],
    warnings: [
      'This creates a local review plan only; it does not repair or modify the Geometry.',
      `${unavailableCapabilities.length} advanced diagnostic capability/capabilities remain unavailable from current evidence.`,
    ],
  }
}
