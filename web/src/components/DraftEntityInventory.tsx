import { Eye, EyeOff, Shapes } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { parseDraftEntities, parseGhostEntities, type ParameterEntity } from '../lib/draftEntities'
import { ManifestMemberGroup } from './ManifestMemberGroup'

export function useDraftEntities(params: unknown) {
  return useMemo(() => parseDraftEntities(params), [params])
}

export function useGhostEntities(params: unknown) {
  return useMemo(() => parseGhostEntities(params), [params])
}

export function useParameterEntityVisibility(params: unknown) {
  const [state, setState] = useState<{ source: unknown; visibility: Record<string, boolean> }>({
    source: params,
    visibility: {},
  })
  const visibility = state.source === params ? state.visibility : {}
  return [visibility, (next: Record<string, boolean>) => setState({ source: params, visibility: next })] as const
}

export function ParameterEntityInventory({
  entities,
  visibility,
  onVisibilityChange,
  source,
}: {
  entities: ParameterEntity[]
  visibility: Record<string, boolean>
  onVisibilityChange: (visibility: Record<string, boolean>) => void
  source: ParameterEntity['source']
}) {
  const { t } = useI18n()
  if (!entities.length) return null
  const label = source === 'ghost' ? t('Ghost entities') : t('Draft entities')
  const renderableEntities = entities.filter((entity) => entity.renderable)
  const visibleCount = renderableEntities.filter((entity) => visibility[entity.key] ?? false).length
  const bulkVisibility = (visible: boolean) => Object.fromEntries(
    renderableEntities.map((entity) => [entity.key, visible]),
  )
  return (
    <ManifestMemberGroup
      label={label}
      memberLabel={label}
      icon={<Shapes size={13} aria-hidden="true" />}
      total={entities.length}
      visibleCount={visibleCount}
      defaultExpanded={false}
      showVisibilityControl={renderableEntities.length > 0}
      onHideAll={() => onVisibilityChange({ ...visibility, ...bulkVisibility(false) })}
      onShowAll={() => onVisibilityChange({ ...visibility, ...bulkVisibility(true) })}
    >
      {entities.map((entity) => {
        const visible = visibility[entity.key] ?? false
        return (
          <div className={`geometry-entity-row ${visible ? '' : 'hidden'}`} data-entity-id={entity.id} key={entity.key}>
            <div className="geometry-entity-select draft-entity-label">
              <span className={`viewer-color-swatch ${source === 'ghost' ? 'ghost-entity-swatch' : 'draft-entity-swatch'}`} />
              <span title={entity.name}>{entity.name}</span>
              <small>{entity.renderable ? entity.type : t('Metadata only')}</small>
            </div>
            <button
              type="button"
              className="geometry-entity-visibility"
              disabled={!entity.renderable}
              title={!entity.renderable ? t('Spatial geometry is unavailable') : undefined}
              aria-label={entity.renderable
                ? t(visible ? 'Hide parameter entity {name}' : 'Show parameter entity {name}').replace('{name}', entity.name)
                : t('Spatial geometry is unavailable')}
              aria-pressed={visible}
              onClick={() => onVisibilityChange({ ...visibility, [entity.key]: !visible })}
            >
              {visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </div>
        )
      })}
    </ManifestMemberGroup>
  )
}
