import { AlertCircle, Check, Info, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useI18n } from '../i18n'

export type DraftSettings = {
  unitSystem: 'SI' | 'Imperial' | 'CGS'
  projectLengthUnit: 'm' | 'mm' | 'cm' | 'inch'
  useGeometryAI: boolean
  useBetaMesher: boolean
}

const unitSystems: DraftSettings['unitSystem'][] = ['SI', 'Imperial', 'CGS']
const lengthUnits: DraftSettings['projectLengthUnit'][] = ['m', 'mm', 'cm', 'inch']

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function readDraftSettings(parameters: Record<string, unknown>): DraftSettings {
  const cache = record(parameters.private_attribute_asset_cache)
  const unitSystem = stringValue(record(parameters.unit_system).name, 'SI') as DraftSettings['unitSystem']
  const projectLengthUnit = stringValue(record(cache.project_length_unit).units, 'm') as DraftSettings['projectLengthUnit']
  return {
    unitSystem: unitSystems.includes(unitSystem) ? unitSystem : 'SI',
    projectLengthUnit: lengthUnits.includes(projectLengthUnit) ? projectLengthUnit : 'm',
    useGeometryAI: cache.use_geometry_AI === true,
    useBetaMesher: cache.use_inhouse_mesher === true,
  }
}

export function applyDraftSettings(parameters: Record<string, unknown>, settings: DraftSettings): Record<string, unknown> {
  const cache = record(parameters.private_attribute_asset_cache)
  return {
    ...parameters,
    unit_system: { ...record(parameters.unit_system), name: settings.unitSystem },
    private_attribute_asset_cache: {
      ...cache,
      project_length_unit: { value: 1, units: settings.projectLengthUnit },
      use_geometry_AI: settings.useGeometryAI,
      use_inhouse_mesher: settings.useBetaMesher,
    },
  }
}

export default function DraftSettingsPanel({
  draftId,
  parameters,
  solverVersion,
  onApply,
  onClose,
}: {
  draftId: string
  parameters: Record<string, unknown>
  solverVersion?: string
  onApply: (parameters: Record<string, unknown>) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [settings, setSettings] = useState(() => readDraftSettings(parameters))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setSettings(readDraftSettings(parameters)), [parameters])

  const update = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
      ...(key === 'useGeometryAI' && value === true ? { useBetaMesher: true } : {}),
    }))
    setError('')
  }

  const apply = async () => {
    if (busy) return
    if (settings.useGeometryAI && !settings.useBetaMesher) {
      setError(t('Geometry AI requires the beta mesher.'))
      return
    }
    setBusy(true)
    setError('')
    try {
      let next = applyDraftSettings(parameters, settings)
      const current = readDraftSettings(parameters)
      if (current.unitSystem !== settings.unitSystem) {
        const response = await api.convertDraftParameterUnits(draftId, next, settings.unitSystem)
        next = response.simulation_params
        // The conversion service intentionally leaves project_length_unit
        // untouched; restore the explicit project setting selected by the user.
        next = applyDraftSettings(next, settings)
      }
      onApply(next)
      onClose()
    } catch (cause) {
      setError(String(cause).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="draft-settings-panel" aria-label={t('Draft settings')}>
      <header className="draft-settings-panel__header">
        <div><Settings2 size={16} /><strong>{t('Draft settings')}</strong><span>{t('Runtime context for this Draft')}</span></div>
        <button type="button" onClick={onClose} disabled={busy}>{t('Cancel')}</button>
      </header>

      <div className="draft-settings-panel__body">
        <div className="draft-settings-section">
          <div className="draft-settings-section__title"><strong>{t('Units system')}</strong><span>{t('Change all dimensional quantities in this Draft at once.')}</span></div>
          <label>
            <span>{t('Unit system')}</span>
            <select value={settings.unitSystem} disabled={busy} onChange={(event) => update('unitSystem', event.target.value as DraftSettings['unitSystem'])}>
              {unitSystems.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>{t('Project length unit')}</span>
            <select value={settings.projectLengthUnit} disabled={busy} onChange={(event) => update('projectLengthUnit', event.target.value as DraftSettings['projectLengthUnit'])}>
              {lengthUnits.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <div className="draft-settings-section">
          <div className="draft-settings-section__title"><strong>{t('Meshing features')}</strong><span>{t('These flags are sent with the Draft run request.')}</span></div>
          <label className="draft-settings-toggle">
            <span><strong>{t('GeometryAI')}</strong><small>{t('Use the GeometryAI surface mesher.')}</small></span>
            <input type="checkbox" checked={settings.useGeometryAI} disabled={busy} onChange={(event) => update('useGeometryAI', event.target.checked)} />
          </label>
          <label className="draft-settings-toggle">
            <span><strong>{t('Beta mesher')}</strong><small>{t('Use the beta version of Mesher for this Draft.')}</small></span>
            <input type="checkbox" checked={settings.useBetaMesher} disabled={busy || settings.useGeometryAI} onChange={(event) => update('useBetaMesher', event.target.checked)} />
          </label>
          {settings.useGeometryAI && <p className="draft-settings-note"><Info size={14} />{t('GeometryAI automatically enables the beta mesher because Flow360 requires both flags.')}</p>}
        </div>

        <div className="draft-settings-section">
          <div className="draft-settings-section__title"><strong>{t('Solver version')}</strong><span>{t('Solver version is fixed when the Draft is created.')}</span></div>
          <select value={solverVersion || t('Default')} disabled aria-label={t('Solver version')}>
            <option>{solverVersion || t('Default')}</option>
          </select>
        </div>

        {error && <p className="draft-settings-error" role="alert"><AlertCircle size={14} />{error}</p>}
      </div>
      <footer className="draft-settings-panel__footer">
        <small>{t('Apply adds these changes to the Draft candidate. Use Save in the editor to persist them.')}</small>
        <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>
          {busy ? <RefreshCw size={14} className="spin" /> : <Check size={14} />}
          {busy ? t('Converting…') : t('Apply settings')}
        </button>
      </footer>
    </section>
  )
}
