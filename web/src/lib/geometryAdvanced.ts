import type {
  AgentAction,
  GeometryComparison,
  GeometryDiagnosticReport,
  ProjectInfo,
} from '../api/client'

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
