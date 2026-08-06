import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProjectPage from './pages/ProjectPage'
import WorkspacePage from './pages/WorkspacePage'
import ComparePage from './pages/ComparePage'

const TutorialLibraryPage = lazy(() => import('./pages/TutorialLibraryPage'))
const TutorialPage = lazy(() => import('./pages/TutorialPage'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading">Loading experience…</div>}>
        <Routes>
          <Route path="/" element={<WorkspacePage />} />
          <Route path="/tutorials" element={<TutorialLibraryPage />} />
          <Route path="/tutorials/:tutorialId" element={<TutorialPage />} />
          <Route path="/projects/:projectId/compare" element={<ComparePage />} />
          <Route path="/projects/:projectId/*" element={<ProjectPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
