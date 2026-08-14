import { Eye, EyeOff, Pencil, Plus, Shapes } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { parameterEntityLengthUnit, parseDraftEntities, parseGhostEntities, type DraftEntityMutation, type ParameterEntity } from '../lib/draftEntities'
import { ManifestMemberGroup } from './ManifestMemberGroup'
import DraftEntityEditorDialog, { editableDraftEntityTypes } from './DraftEntityEditorDialog'

type DraftEntityEditorState =
  | { mode: 'new'; entityType: ParameterEntity['type'] }
  | { mode: 'edit'; entity: ParameterEntity }

export function useDraftEntities(params: unknown) {
  return useMemo(() => parseDraftEntities(params), [params])
}

export function useGhostEntities(params: unknown) {
  return useMemo(() => parseGhostEntities(params), [params])
}

export function useParameterEntityUnit(params: unknown) {
  return useMemo(() => parameterEntityLengthUnit(params), [params])
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
  unit = 'm',
  onMutate,
}: {
  entities: ParameterEntity[]
  visibility: Record<string, boolean>
  onVisibilityChange: (visibility: Record<string, boolean>) => void
  source: ParameterEntity['source']
  unit?: string
  onMutate?: (mutation: DraftEntityMutation) => Promise<void>
}) {
  const { t } = useI18n()
  const [editor, setEditor] = useState<DraftEntityEditorState | null>(null)
  const [saving, setSaving] = useState(false)
  if (!entities.length && !(source === 'draft' && onMutate)) return null
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
      {source === 'draft' && onMutate && (
        <div className="parameter-entity-actions">
          <div className="parameter-entity-create">
            <Plus size={12} aria-hidden="true" />
            <select
              aria-label={t('Add entity')}
              value=""
              onChange={(event) => {
                if (event.target.value) setEditor({ mode: 'new', entityType: event.target.value as ParameterEntity['type'] })
              }}
            >
              <option value="" disabled>{t('Add entity…')}</option>
              {editableDraftEntityTypes.map((type) => <option value={type} key={type}>{type}</option>)}
            </select>
          </div>
        </div>
      )}
      {entities.map((entity) => {
        const visible = visibility[entity.key] ?? false
        return (
          <div className={`geometry-entity-row ${visible ? '' : 'hidden'} ${source === 'draft' && onMutate ? 'editable' : ''}`.trim()} data-entity-id={entity.id} key={entity.key}>
            <div className="geometry-entity-select draft-entity-label">
              <span className={`viewer-color-swatch ${source === 'ghost' ? 'ghost-entity-swatch' : 'draft-entity-swatch'}`} />
              <span className="geometry-face-name">
                <span title={entity.name}>{entity.name}</span>
                <small>{entity.renderable ? entity.type : t('Metadata only')}</small>
              </span>
            </div>
            {source === 'draft' && onMutate && (
              <button type="button" className="geometry-entity-edit" onClick={() => setEditor({ mode: 'edit', entity })} aria-label={t('Edit Draft entity {name}').replace('{name}', entity.name)} title={t('Edit Draft entity')}>
                <Pencil size={12} />
              </button>
            )}
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
      {editor && source === 'draft' && onMutate && (
        <DraftEntityEditorDialog
          entity={editor.mode === 'edit' ? editor.entity : undefined}
          initialType={editor.mode === 'new' ? editor.entityType : editor.entity.type}
          unit={unit}
          saving={saving}
          onClose={() => setEditor(null)}
          onSave={async (entity) => {
            setSaving(true)
            try {
              await onMutate({ type: 'upsert', previousId: editor.mode === 'new' ? undefined : editor.entity.id, entity })
              setEditor(null)
            } finally {
              setSaving(false)
            }
          }}
          onDelete={editor.mode === 'new' ? undefined : async () => {
            setSaving(true)
            try {
              await onMutate({ type: 'delete', id: editor.entity.id })
              setEditor(null)
            } finally {
              setSaving(false)
            }
          }}
        />
      )}
    </ManifestMemberGroup>
  )
}
