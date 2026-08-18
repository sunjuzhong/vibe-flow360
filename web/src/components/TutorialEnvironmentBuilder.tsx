import { AlertTriangle, Check, CheckCircle2, Cloud, Folder, RefreshCw, Rocket } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Flow360Status, type FolderNode } from '../api/client'
import { useI18n } from '../i18n'
import {
  createT01Environment,
  type TutorialEnvironmentClient,
  type TutorialEnvironmentResult,
  type TutorialEnvironmentStage,
} from '../tutorials/t01'

export type FolderOption = { id: string; label: string }

export function tutorialFolderOptions(root: FolderNode): FolderOption[] {
  const options: FolderOption[] = []
  const visit = (node: FolderNode, parents: string[]) => {
    const path = [...parents, node.name]
    options.push({ id: node.id, label: path.join(' / ') })
    for (const child of node.subfolders ?? []) visit(child, path)
  }
  for (const folder of root.subfolders ?? []) visit(folder, [])
  if (!options.length) options.push({ id: root.id, label: root.name })
  return options
}

export function preferredTutorialFolder(options: FolderOption[]): string {
  return options.find((option) => option.label.trim().toLowerCase() === 'tutorials')?.id ?? options[0]?.id ?? ''
}

export function tutorialEnvironmentPath(
  result: { projectId: string; baselineDraft: { id: string } },
  tutorialId: string,
): string {
  return `/projects/${encodeURIComponent(result.projectId)}?draft=${encodeURIComponent(result.baselineDraft.id)}&tutorial=${encodeURIComponent(tutorialId)}`
}

const stageOrder: TutorialEnvironmentStage[] = ['staging', 'creating-project', 'creating-drafts', 'ready']
function countWord(draftCount: 1 | 2 | 3): string { return draftCount === 1 ? 'one' : draftCount === 2 ? 'two' : 'three' }
function stageCopy(draftKind: string, draftCount: 1 | 2 | 3): Record<TutorialEnvironmentStage, string> {
  return {
    staging: 'Stage bundled geometry',
    'creating-project': 'Create and process Geometry',
    'creating-drafts': `Configure ${countWord(draftCount)} ${draftKind} Draft${draftCount === 1 ? '' : 's'}`,
    ready: 'Ready for review',
  }
}

type EnvironmentCreator = (
  input: { folderId: string; projectName: string },
  client: TutorialEnvironmentClient,
  onStage: (stage: TutorialEnvironmentStage) => void,
) => Promise<TutorialEnvironmentResult>

export type TutorialEnvironmentBuilderProps = {
  status: Flow360Status | null
  tutorialId?: string
  defaultProjectName?: string
  heading?: string
  description?: string
  configurationSummary?: string
  draftKind?: string
  baselineValue?: string
  variantValue?: string
  thirdValue?: string
  successDescription?: string
  draftCount?: 1 | 2 | 3
  createEnvironment?: EnvironmentCreator
}

export default function TutorialEnvironmentBuilder({
  status,
  tutorialId = 'T01',
  defaultProjectName = 'Tutorial T01 · Lift and drag',
  heading = 'Build the T01 environment from this lesson',
  description = 'The app uploads the bundled aircraft, waits for its Geometry, and creates two configured Flow360 Case Drafts.',
  configurationSummary = 'Mesh, physics, boundaries, outputs, α 0° and α 5°',
  draftKind = 'Case',
  baselineValue = 'α = 0°',
  variantValue = 'α = 5°',
  thirdValue = '',
  successDescription = 'The Geometry is processed and both Case Drafts have their parameters configured. No mesh or Case computation has been submitted.',
  draftCount = 2,
  createEnvironment = createT01Environment,
}: TutorialEnvironmentBuilderProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [folders, setFolders] = useState<FolderOption[]>([])
  const [folderId, setFolderId] = useState('')
  const [projectName, setProjectName] = useState(() => t(defaultProjectName))
  const [confirmed, setConfirmed] = useState(false)
  const [stage, setStage] = useState<TutorialEnvironmentStage | null>(null)
  const [result, setResult] = useState<TutorialEnvironmentResult | null>(null)
  const [error, setError] = useState('')
  const busy = stage !== null && stage !== 'ready'
  const stages = stageCopy(draftKind, draftCount)

  useEffect(() => {
    api.folders()
      .then((response) => {
        const options = tutorialFolderOptions(response.data.root)
        setFolders(options)
        setFolderId(preferredTutorialFolder(options))
      })
      .catch((cause) => setError(String(cause).replace('Error: ', '')))
  }, [])

  const currentStage = stage ? stageOrder.indexOf(stage) : -1
  const canCreate = Boolean(status?.available && folderId && projectName.trim() && confirmed && !busy && !result)
  const selectedFolder = useMemo(() => folders.find((folder) => folder.id === folderId), [folders, folderId])
  const authorizationCopy = `I reviewed the destination and authorize creation of this remote Flow360 Project and ${countWord(draftCount)} configured ${draftKind} Draft${draftCount === 1 ? '' : 's'}. Nothing is submitted until I review and run a Draft.`

  const create = async () => {
    if (!canCreate) return
    setError('')
    try {
      const created = await createEnvironment(
        { folderId, projectName: projectName.trim() },
        api,
        setStage,
      )
      setResult(created)
      navigate(tutorialEnvironmentPath(created, tutorialId))
    } catch (cause) {
      setStage(null)
      setError(String(cause).replace('Error: ', ''))
    }
  }

  if (result) {
    return <div className="tutorial-environment-success">
      <div className="environment-success-heading"><CheckCircle2 size={28}/><div><span>EXPERIMENT ENVIRONMENT READY</span><strong>{projectName}</strong><p>{successDescription}</p></div></div>
      <div className={`environment-plan-pair ${draftCount === 3 ? 'three' : ''}`}>
        <article><span>BASELINE</span><strong>{baselineValue}</strong><small>Draft parameters synced</small></article>
        {draftCount >= 2 && <article><span>CONTROLLED VARIANT</span><strong>{variantValue}</strong><small>Draft parameters synced</small></article>}
        {draftCount === 3 && <article><span>METHOD ESCALATION</span><strong>{thirdValue}</strong><small>Draft parameters synced</small></article>}
      </div>
      <button className="lesson-workspace-button" onClick={() => navigate(tutorialEnvironmentPath(result, tutorialId))}>
        <span>Review configured Drafts</span><Rocket size={17}/>
      </button>
    </div>
  }

  return <div className="tutorial-environment-builder">
    <div className="environment-builder-heading">
      <div className="run-ready-icon"><Rocket size={25}/></div>
      <div><span>CREATE THE EXPERIMENT</span><strong>{heading}</strong><p>{description}</p></div>
    </div>

    <div className="environment-form-grid">
      <label><span>Project name</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} disabled={busy}/></label>
      <label><span>Destination folder</span><select value={folderId} onChange={(event) => setFolderId(event.target.value)} disabled={busy || !folders.length}>
        {!folders.length && <option value="">Loading folders…</option>}
        {folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.label}</option>)}
      </select></label>
    </div>

    <div className="environment-summary">
      <div><Folder size={15}/><span><strong>{selectedFolder?.label || 'Choose a destination'}</strong><small>Flow360 Project · release-25.10 · geometry unit m</small></span></div>
      <div><CheckCircle2 size={15}/><span><strong>Parameters already configured</strong><small>{configurationSummary}</small></span></div>
    </div>

    {stage && <div className="environment-progress">
      {stageOrder.map((item, index) => <div className={`${index < currentStage ? 'complete' : ''} ${index === currentStage ? 'active' : ''}`} key={item}>
        <span>{index < currentStage || item === 'ready' ? <Check size={12}/> : index + 1}</span><small>{stages[item]}</small>
      </div>)}
    </div>}

    {error && <div className="lesson-callout warning"><AlertTriangle size={17}/><p><strong>Environment creation stopped</strong>{error} If the Project was already created, refresh Workspace before retrying to avoid a duplicate.</p></div>}
    {!status?.available && <div className="cloud-readiness"><Cloud size={17}/><span><strong>Flow360 connection required</strong><small>Connect the local Flow360 profile before creating this environment.</small></span></div>}

    <label className="environment-confirm">
      <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy}/>
      <span>{t(authorizationCopy)}</span>
    </label>
    <button className="environment-create-button" disabled={!canCreate} onClick={() => void create()}>
      {busy ? <RefreshCw size={16} className="spin"/> : <Rocket size={16}/>} {busy && stage ? stages[stage] : `Create Project + ${draftCount} ${draftKind} Draft${draftCount === 1 ? '' : 's'}`}
    </button>
  </div>
}
