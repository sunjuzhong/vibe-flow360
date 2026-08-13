import { Eye, EyeOff, Shapes } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { parseDraftEntities, type DraftEntity } from '../lib/draftEntities'
import { ManifestMemberGroup, manifestVisibilityMap } from './ManifestMemberGroup'

export function useDraftEntities(params: unknown) {
  return useMemo(() => parseDraftEntities(params), [params])
}

export function useDraftEntityVisibility(params: unknown) {
  const [state, setState] = useState<{ source: unknown; visibility: Record<string, boolean> }>({
    source: params,
    visibility: {},
  })
  const visibility = state.source === params ? state.visibility : {}
  return [visibility, (next: Record<string, boolean>) => setState({ source: params, visibility: next })] as const
}

export function DraftEntityInventory({
  entities,
  visibility,
  onVisibilityChange,
}: {
  entities: DraftEntity[]
  visibility: Record<string, boolean>
  onVisibilityChange: (visibility: Record<string, boolean>) => void
}) {
  const { t } = useI18n()
  if (!entities.length) return null
  const visibleCount = entities.filter((entity) => visibility[entity.id] ?? false).length
  return (
    <ManifestMemberGroup
      label={t('Draft entities')}
      memberLabel={t('Draft entities')}
      icon={<Shapes size={13} aria-hidden="true" />}
      total={entities.length}
      visibleCount={visibleCount}
      defaultExpanded={false}
      onHideAll={() => onVisibilityChange({ ...visibility, ...manifestVisibilityMap(entities, false) })}
      onShowAll={() => onVisibilityChange({ ...visibility, ...manifestVisibilityMap(entities, true) })}
    >
      {entities.map((entity) => {
        const visible = visibility[entity.id] ?? false
        return (
          <div className={`geometry-entity-row ${visible ? '' : 'hidden'}`} data-entity-id={entity.id} key={entity.id}>
            <div className="geometry-entity-select draft-entity-label">
              <span className="viewer-color-swatch draft-entity-swatch" />
              <span title={entity.name}>{entity.name}</span>
              <small>{entity.type}</small>
            </div>
            <button
              type="button"
              className="geometry-entity-visibility"
              aria-label={t(visible ? 'Hide draft entity {name}' : 'Show draft entity {name}').replace('{name}', entity.name)}
              aria-pressed={visible}
              onClick={() => onVisibilityChange({ ...visibility, [entity.id]: !visible })}
            >
              {visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </div>
        )
      })}
    </ManifestMemberGroup>
  )
}
