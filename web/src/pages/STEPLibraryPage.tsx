import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type Flow360Status } from '../api/client'
import STEPLibraryModal from '../components/STEPLibraryModal'
import TopBar from '../components/TopBar'

export default function STEPLibraryPage() {
  const { assetId } = useParams()
  const [status, setStatus] = useState<Flow360Status | null>(null)

  useEffect(() => {
    api.flow360Status().then(setStatus).catch(() => setStatus({ available: false }))
  }, [])

  return <div className="step-library-route">
    <TopBar status={status} title="STEP geometry library" />
    <STEPLibraryModal key={assetId || 'step-library'} embedded assetId={assetId} />
  </div>
}
