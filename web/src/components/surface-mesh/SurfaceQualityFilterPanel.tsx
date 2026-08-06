import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { UVFFieldFilter, UVFFieldFilterRule, UVFFieldInfo } from '../../lib/uvf-three'
import { formatFieldValue } from '../../lib/uvf-three'

export function SurfaceQualityFilterPanel({
  fields,
  filter,
  matchCount,
  onAddRule,
  onRemoveRule,
  onUpdateRule,
  onEnabledChange,
  onOperatorChange,
  onReset,
  elementLabel = 'Triangle',
}: {
  fields: UVFFieldInfo[]
  filter: UVFFieldFilter
  matchCount: number
  onAddRule: () => void
  onRemoveRule: (ruleId: string) => void
  onUpdateRule: (ruleId: string, patch: Partial<UVFFieldFilterRule>) => void
  onEnabledChange: (enabled: boolean) => void
  onOperatorChange: (operator: 'and' | 'or') => void
  onReset: () => void
  elementLabel?: string
}) {
  const fieldByName = new Map(fields.map((field) => [field.name, field]))
  return (
    <section className="surface-quality-filter-panel" aria-label={`${elementLabel} quality filter`}>
      <div className="surface-quality-filter-heading">
        <div>
          <strong>{elementLabel} range filter</strong>
          <small>Matching elements are outlined in orange</small>
        </div>
        <label className="surface-quality-filter-toggle">
          <input
            type="checkbox"
            checked={filter.enabled}
            disabled={filter.rules.length === 0}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          Enabled
        </label>
      </div>

      {filter.rules.length > 1 && (
        <label className="surface-quality-filter-operator">
          Match {elementLabel.toLocaleLowerCase()}s satisfying
          <select value={filter.operator} onChange={(event) => onOperatorChange(event.target.value as 'and' | 'or')}>
            <option value="and">ALL rules (AND)</option>
            <option value="or">ANY rule (OR)</option>
          </select>
        </label>
      )}

      <div className="surface-quality-filter-rules">
        {filter.rules.map((rule, index) => {
          const field = fieldByName.get(rule.fieldName)
          const step = field ? (field.max - field.min) / 1000 || 1 : 'any'
          return (
            <div className="surface-quality-filter-rule" key={rule.id}>
              <div className="surface-quality-filter-rule-head">
                <span>{filter.rules.length > 1 ? `${index === 0 ? '' : filter.operator.toUpperCase() + ' '}Rule ${index + 1}` : 'Rule 1'}</span>
                <button type="button" title="Remove rule" onClick={() => onRemoveRule(rule.id)}><Trash2 size={12} /></button>
              </div>
              <select
                aria-label={`Rule ${index + 1} field`}
                value={field ? rule.fieldName : ''}
                onChange={(event) => onUpdateRule(rule.id, { fieldName: event.target.value })}
              >
                {!field && <option value="">Missing field: {rule.fieldName}</option>}
                {fields.map((candidate) => <option key={candidate.name} value={candidate.name}>{candidate.name}</option>)}
              </select>
              <div className="surface-quality-filter-bounds">
                <label>
                  Min
                  <input
                    type="number"
                    step={step}
                    value={rule.min}
                    onChange={(event) => onUpdateRule(rule.id, { min: Number(event.target.value) })}
                  />
                </label>
                <span>to</span>
                <label>
                  Max
                  <input
                    type="number"
                    step={step}
                    value={rule.max}
                    onChange={(event) => onUpdateRule(rule.id, { max: Number(event.target.value) })}
                  />
                </label>
              </div>
              {field && <small>Available: {formatFieldValue(field.min)} – {formatFieldValue(field.max)}</small>}
            </div>
          )
        })}
      </div>

      <div className="surface-quality-filter-actions">
        <button type="button" disabled={fields.length === 0 || filter.rules.length >= 20} onClick={onAddRule}>
          <Plus size={12} /> Add rule
        </button>
        <button type="button" disabled={filter.rules.length === 0} onClick={onReset}>
          <RotateCcw size={12} /> Clear
        </button>
        <span className={filter.enabled && filter.rules.length > 0 ? 'active' : ''}>
          {filter.enabled && filter.rules.length > 0 ? `${matchCount.toLocaleString()} matched` : 'Filter inactive'}
        </span>
      </div>
    </section>
  )
}
