import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProjectPage from './pages/ProjectPage'
import WorkspacePage from './pages/WorkspacePage'
import ComparePage from './pages/ComparePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WorkspacePage />} />
        <Route path="/projects/:projectId/compare" element={<ComparePage />} />
        <Route path="/projects/:projectId/*" element={<ProjectPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
