import { AlertTriangle, CheckCircle2, Crosshair, RotateCcw, ShieldAlert } from 'lucide-react'
import type {
  VolumeQualityAssessment,
  VolumeQualityFinding,
  VolumeQualityThreshold,
  VolumeQualityThresholdOverride,
} from '../../lib/volumeMeshReview'

export function VolumeQualityAssessmentPanel({
  assessment,
  thresholds,
  selectedFieldName,
  onThresholdChange,
  onResetThreshold,
  onResetAll,
  onReviewFinding,
}: {
  assessment: VolumeQualityAssessment
  thresholds: VolumeQualityThreshold[]
  selectedFieldName: string | null
  onThresholdChange: (fieldName: string, patch: Partial<VolumeQualityThresholdOverride>) => void
  onResetThreshold: (fieldName: string) => void
  onResetAll: () => void
  onReviewFinding: (finding: VolumeQualityFinding) => void
}) {
  const activeThreshold = thresholds.find((threshold) => threshold.fieldName === selectedFieldName)
  const queue = assessment.findings.filter((finding) => finding.severity !== 'pass')

  return (
    <section className="volume-quality-assessment" aria-label="Volume mesh quality assessment">
      <div className="volume-quality-assessment-head">
        <div>
          <strong>Engineering thresholds</strong>
          <small>Screening baselines — confirm against solver and project requirements</small>
        </div>
        <button type="button" disabled={thresholds.every((threshold) => threshold.source === 'baseline')} onClick={onResetAll}>
          <RotateCcw size={11} /> Reset all
        </button>
      </div>

      <div className="volume-quality-scoreboard">
        <span className="critical"><ShieldAlert size={12} /> {assessment.criticalCount} critical</span>
        <span className="warning"><AlertTriangle size={12} /> {assessment.warningCount} warning</span>
        <span className="pass"><CheckCircle2 size={12} /> {assessment.passCount} pass</span>
      </div>

      {activeThreshold ? (
        <div className="volume-quality-threshold-editor">
          <div>
            <strong>{activeThreshold.fieldName}</strong>
            <span>{activeThreshold.riskDirection === 'min' ? 'Lower is riskier' : 'Higher is riskier'} · {activeThreshold.source}</span>
          </div>
          <label>Warning
            <input
              type="number"
              value={activeThreshold.warning}
              step="any"
              onChange={(event) => onThresholdChange(activeThreshold.fieldName, { warning: Number(event.target.value) })}
            />
          </label>
          <label>Critical
            <input
              type="number"
              value={activeThreshold.critical}
              step="any"
              onChange={(event) => onThresholdChange(activeThreshold.fieldName, { critical: Number(event.target.value) })}
            />
          </label>
          <button type="button" disabled={activeThreshold.source === 'baseline'} title="Reset this field" onClick={() => onResetThreshold(activeThreshold.fieldName)}>
            <RotateCcw size={11} />
          </button>
          <p>{activeThreshold.rationale}</p>
        </div>
      ) : (
        <p className="volume-quality-threshold-empty">
          {selectedFieldName
            ? 'This dimensional or unrecognized field needs a project-specific threshold; no universal limit was inferred.'
            : 'Select a supported quality field to inspect or edit its thresholds.'}
        </p>
      )}

      <div className="volume-quality-queue-head">
        <strong>Bad-region review queue</strong>
        <span>{queue.length} to review</span>
      </div>
      <div className="volume-quality-queue">
        {queue.map((finding) => (
          <article className={finding.severity} key={finding.id}>
            <div>
              {finding.severity === 'critical' ? <ShieldAlert size={13} /> : <AlertTriangle size={13} />}
              <span><strong>{finding.fieldName}</strong><small>{finding.severity}</small></span>
            </div>
            <p>
              Worst {finding.worstValue.toPrecision(5)} · {finding.riskDirection === 'min' ? '≤' : '≥'} warning {finding.warningThreshold.toPrecision(5)}
            </p>
            {finding.estimatedWarningCount !== undefined && finding.sampleCount !== undefined && (
              <small className="volume-quality-estimate">
                ≈ {finding.estimatedWarningCount.toLocaleString()} / {finding.sampleCount.toLocaleString()} field samples exceed warning; histogram estimate
              </small>
            )}
            <p className="volume-quality-advice">{finding.advice}</p>
            <button type="button" onClick={() => onReviewFinding(finding)}><Crosshair size={11} /> Highlight risk range</button>
          </article>
        ))}
        {queue.length === 0 && assessment.findings.length > 0 && (
          <p className="volume-quality-queue-empty"><CheckCircle2 size={13} /> No supported field extrema cross the current thresholds.</p>
        )}
        {assessment.findings.length === 0 && (
          <p className="volume-quality-queue-empty">No field has a safe built-in baseline. Add a project-specific range using the advanced filter below.</p>
        )}
      </div>
      {assessment.unsupportedFields.length > 0 && (
        <small className="volume-quality-unsupported">
          No universal threshold inferred for: {assessment.unsupportedFields.join(', ')}.
        </small>
      )}
    </section>
  )
}
