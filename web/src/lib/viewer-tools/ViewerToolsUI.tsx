import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, ChevronDown, Circle, CircleDot, LandPlot, MapPin, Minus, Route, Ruler, Triangle, Wrench, X } from 'lucide-react'
import type { WorkspaceViewerToolsModel } from '../../hooks/useWorkspaceViewerTools'
import type { BasicToolId } from './basic-tools'
import { formatDistance } from './distance'
import './ViewerToolsUI.css'

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export type ViewerToolsMenuPosition = {
  left: number
  bottom: number
  width: number
}

export function positionViewerToolsMenu(
  anchor: Pick<DOMRect, 'top' | 'right'>,
  viewport: { width: number; height: number },
): ViewerToolsMenuPosition {
  const edge = 10
  const gap = 10
  const width = Math.max(0, Math.min(350, viewport.width - edge * 2))
  const left = Math.min(
    Math.max(edge, anchor.right - width),
    Math.max(edge, viewport.width - width - edge),
  )
  return {
    left,
    bottom: Math.max(edge, viewport.height - anchor.top + gap),
    width,
  }
}

type ContainsTarget = { contains: (target: Node) => boolean }

export function shouldDismissViewerToolsMenu(
  target: EventTarget | null,
  launcher: ContainsTarget | null,
  menu: ContainsTarget | null,
): boolean {
  if (!target) return true
  const node = target as Node
  return !launcher?.contains(node) && !menu?.contains(node)
}

const toolIcons = {
  distance: Ruler,
  point: MapPin,
  line: Minus,
  sphere: Circle,
  polyline: Route,
  angle: Triangle,
  circle: CircleDot,
  area: LandPlot,
  box: Box,
} as const

export function ViewerToolsDock({
  model,
  initiallyOpen = false,
}: {
  model: WorkspaceViewerToolsModel
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const [menuPosition, setMenuPosition] = useState<ViewerToolsMenuPosition | null>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const selectDistance = () => {
    model.activateDistance()
    setOpen(false)
  }
  const selectBasic = (toolId: BasicToolId) => {
    model.activateBasic(toolId)
    setOpen(false)
  }

  useClientLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null)
      return
    }
    const updatePosition = () => {
      const anchor = launcherRef.current?.getBoundingClientRect()
      if (!anchor) return
      setMenuPosition(positionViewerToolsMenu(anchor, {
        width: window.innerWidth,
        height: window.innerHeight,
      }))
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (shouldDismissViewerToolsMenu(event.target, launcherRef.current, menuRef.current)) {
        setOpen(false)
      }
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', dismissOnOutsidePointer)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [open])

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      className={`viewer-tools-menu ${menuPosition ? 'viewer-tools-menu-portal' : ''}`}
      role="toolbar"
      aria-label="Viewer tools"
      style={menuPosition ?? undefined}
    >
      <ToolButton id="distance" label="Distance" active={model.activeToolId === 'distance'} onClick={selectDistance} />
      {model.basic.tools.map((tool) => (
        <ToolButton
          key={tool.id}
          id={tool.id as BasicToolId}
          label={tool.label}
          active={model.activeToolId === tool.id}
          onClick={() => selectBasic(tool.id as BasicToolId)}
        />
      ))}
    </div>
  )

  return (
    <div className={`viewer-tools-dock ${open ? 'open' : ''}`}>
      <button
        ref={launcherRef}
        type="button"
        className={`viewer-tools-launcher ${model.panelOpen ? 'active' : ''}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <Wrench size={13} /> Tools <ChevronDown size={12} />
      </button>
      {open && (typeof document === 'undefined'
        ? menu
        : menuPosition
          ? createPortal(menu, document.body)
          : null)}
    </div>
  )
}

function ToolButton({
  id,
  label,
  active,
  onClick,
}: {
  id: keyof typeof toolIcons
  label: string
  active: boolean
  onClick: () => void
}) {
  const Icon = toolIcons[id]
  return (
    <button type="button" className={active ? 'active' : ''} aria-pressed={active} onClick={onClick} title={label}>
      <Icon size={14} /><span>{label}</span>
    </button>
  )
}

export function ViewerToolPanel({ model }: { model: WorkspaceViewerToolsModel }) {
  if (!model.panelOpen || !model.activeToolId) return null
  return model.activeToolId === 'distance'
    ? <DistancePanel model={model} />
    : <BasicPanel model={model} />
}

function PanelShell({
  toolId,
  title,
  pointCount,
  onClose,
  children,
}: {
  toolId: keyof typeof toolIcons
  title: string
  pointCount: number
  onClose: () => void
  children: React.ReactNode
}) {
  const Icon = toolIcons[toolId]
  return (
    <aside className="viewer-tool-panel" aria-label={`${title} tool`} aria-live="polite">
      <header>
        <span className="viewer-tool-panel-icon"><Icon size={16} /></span>
        <div><small>ACTIVE TOOL</small><strong>{title}</strong></div>
        <span className="viewer-tool-point-count">{pointCount} pts</span>
        <button type="button" onClick={onClose} aria-label={`Close ${title} tool`}><X size={14} /></button>
      </header>
      <div className="viewer-tool-panel-body">{children}</div>
    </aside>
  )
}

function DistancePanel({ model }: { model: WorkspaceViewerToolsModel }) {
  const distance = model.distance
  const prompt = distance.session.status === 'armed'
    ? 'Pick the first point on the model.'
    : distance.session.status === 'collecting'
      ? 'Pick the second point to complete the distance.'
      : null
  return (
    <PanelShell toolId="distance" title="Distance" pointCount={distance.pointCount} onClose={model.closeActive}>
      {prompt && <p className="viewer-tool-instruction">{prompt}<span>Esc cancels</span></p>}
      {distance.error && <p className="viewer-tool-error" role="alert">{distance.error}</p>}
      {distance.result && (
        <div className="viewer-tool-result">
          <small>DISTANCE</small>
          <strong>{formatDistance(distance.result.length)} <span>{distance.result.unit}</span></strong>
          <dl>
            <div><dt>ΔX</dt><dd>{distance.result.deltaXYZ[0].toPrecision(6)}</dd></div>
            <div><dt>ΔY</dt><dd>{distance.result.deltaXYZ[1].toPrecision(6)}</dd></div>
            <div><dt>ΔZ</dt><dd>{distance.result.deltaXYZ[2].toPrecision(6)}</dd></div>
          </dl>
        </div>
      )}
      {distance.result && <p className="viewer-tool-adjust-hint">Drag a point in the viewer to fine-tune it.</p>}
      <DistanceActions model={model} />
    </PanelShell>
  )
}

function DistanceActions({ model }: { model: WorkspaceViewerToolsModel }) {
  const distance = model.distance
  if (distance.session.status === 'saving') return <p className="viewer-tool-muted">Saving annotation…</p>
  if (distance.session.status === 'saved') return (
    <div className="viewer-tool-actions"><span>Saved to project annotations</span><button onClick={distance.retry}>Measure again</button></div>
  )
  if (distance.session.status !== 'complete-draft' && distance.session.status !== 'error') return null
  return (
    <div className="viewer-tool-actions">
      {distance.session.status === 'complete-draft' && <button className="primary" onClick={() => { void distance.save() }}>Save</button>}
      {distance.session.status === 'error' && distance.session.cause === 'save' && <button onClick={distance.resumeDraft}>Return to draft</button>}
      <button onClick={distance.retry}>Retry</button><button onClick={distance.discard}>Discard</button>
    </div>
  )
}

function BasicPanel({ model }: { model: WorkspaceViewerToolsModel }) {
  const basic = model.basic
  return (
    <PanelShell toolId={basic.activeToolId} title={basic.definition.label} pointCount={basic.pointCount} onClose={model.closeActive}>
      {basic.prompt && <p className="viewer-tool-instruction">{basic.prompt}</p>}
      {basic.notice && <p className="viewer-tool-notice" role="status">{basic.notice}</p>}
      {basic.error && <p className="viewer-tool-error" role="alert">{basic.error}</p>}
      {basic.resultSummary && <div className="viewer-tool-result"><small>RESULT</small><strong>{basic.resultSummary}</strong></div>}
      {basic.resultSummary && <p className="viewer-tool-adjust-hint">Drag any control point in the viewer to fine-tune it.</p>}
      <BasicActions model={model} />
    </PanelShell>
  )
}

function BasicActions({ model }: { model: WorkspaceViewerToolsModel }) {
  const basic = model.basic
  if (basic.session.status === 'saving') return <p className="viewer-tool-muted">Saving annotation…</p>
  if (basic.session.status === 'saved') return (
    <div className="viewer-tool-actions"><span>Saved to project annotations</span><button onClick={() => basic.activate(basic.activeToolId)}>Create another</button></div>
  )
  if (basic.session.status !== 'complete-draft' && basic.session.status !== 'error') return null
  return (
    <div className="viewer-tool-actions">
      {basic.session.status === 'complete-draft' && <button className="primary" onClick={() => { void basic.save() }}>Save</button>}
      {basic.session.status === 'error' && basic.session.cause === 'save' && <button onClick={basic.resumeDraft}>Return to draft</button>}
      <button onClick={basic.retry}>Retry</button><button onClick={basic.discard}>Discard</button>
    </div>
  )
}
