import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProjectPage from './pages/ProjectPage'
import WorkspacePage from './pages/WorkspacePage'
import ComparePage from './pages/ComparePage'
import CompareWorkspaceListPage from './pages/CompareWorkspaceListPage'
import { useI18n } from './i18n'
import { clearLazyRouteRecovery, importLazyRoute } from './lib/lazyRoute'
import './route.css'

const TutorialLibraryPage = lazy(() => importLazyRoute(() => import('./pages/TutorialLibraryPage')))
const TutorialPage = lazy(() => importLazyRoute(() => import('./pages/TutorialPage')))
const STEPLibraryPage = lazy(() => importLazyRoute(() => import('./pages/STEPLibraryPage')))

type RouteErrorBoundaryProps = {
  children: ReactNode
  title: string
  detail: string
  reloadLabel: string
}

class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route failed to load', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="route-error" role="alert">
        <h1>{this.props.title}</h1>
        <p>{this.props.detail}</p>
        <button type="button" onClick={() => {
          clearLazyRouteRecovery()
          window.location.reload()
        }}>{this.props.reloadLabel}</button>
      </main>
    )
  }
}

function AppRoutes() {
  const { t } = useI18n()
  return (
    <RouteErrorBoundary
      title={t('This page could not be loaded')}
      detail={t('The application may have been updated. Reload to use the latest version.')}
      reloadLabel={t('Reload')}
    >
      <Suspense fallback={<div className="route-loading">{t('Loading experience…')}</div>}>
        <Routes>
          <Route path="/" element={<WorkspacePage />} />
          <Route path="/tutorials" element={<TutorialLibraryPage />} />
          <Route path="/step-library" element={<STEPLibraryPage />} />
          <Route path="/tutorials/:tutorialId" element={<TutorialPage />} />
          <Route path="/projects/:projectId/compare" element={<ComparePage />} />
          <Route path="/compares" element={<CompareWorkspaceListPage />} />
          <Route path="/compares/:compareId" element={<ComparePage />} />
          <Route path="/projects/:projectId/*" element={<ProjectPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
