import { useEffect, useState } from 'react'
import { api, type Flow360Status } from '../api/client'
import STEPLibraryModal from '../components/STEPLibraryModal'
import TopBar from '../components/TopBar'

export default function STEPLibraryPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)

  useEffect(() => {
    api.flow360Status().then(setStatus).catch(() => setStatus({ available: false }))
  }, [])

  return <div className="step-library-route">
    <TopBar status={status} title="STEP geometry library" />
    <STEPLibraryModal embedded />
  </div>
}
