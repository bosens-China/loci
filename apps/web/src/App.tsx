import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { useJobEvents } from '@/hooks/use-job-events'
import { migrateLegacyDocumentPath } from '@/pages/documents/use-document-route'
import { resolveRoute, routePath, type AppRoute } from '@/routing'

const OverviewPage = lazy(() =>
  import('@/pages/OverviewPage').then((module) => ({ default: module.OverviewPage }))
)
const DocumentsPage = lazy(() =>
  import('@/pages/DocumentsPage').then((module) => ({ default: module.DocumentsPage }))
)
const CloudPage = lazy(() =>
  import('@/pages/CloudPage').then((module) => ({ default: module.CloudPage }))
)
const JobsPage = lazy(() =>
  import('@/pages/JobsPage').then((module) => ({ default: module.JobsPage }))
)
const AgentsPage = lazy(() =>
  import('@/pages/AgentsPage').then((module) => ({ default: module.AgentsPage }))
)
const AdminPage = lazy(() =>
  import('@/pages/AdminPage').then((module) => ({ default: module.AdminPage }))
)
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
)

export function App(): React.JSX.Element {
  const [route, setRoute] = useState<AppRoute>(() => {
    migrateLegacyDocumentPath(window.location.pathname)
    return resolveRoute(window.location.pathname)
  })

  useEffect(() => {
    const update = (): void => {
      migrateLegacyDocumentPath(window.location.pathname)
      setRoute(resolveRoute(window.location.pathname))
    }
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  useJobEvents(true)

  const navigate = (next: AppRoute): void => {
    window.history.pushState({}, '', routePath(next))
    setRoute(next)
  }
  return (
    <AppShell route={route} onNavigate={navigate}>
      <Suspense fallback={<PageLoading route={route} />}>{pageFor(route)}</Suspense>
    </AppShell>
  )
}

function pageFor(route: AppRoute): React.JSX.Element {
  if (route === 'documents') return <DocumentsPage />
  if (route === 'cloud') return <CloudPage />
  if (route === 'jobs') return <JobsPage />
  if (route === 'agents') return <AgentsPage />
  if (route === 'admin') return <AdminPage />
  if (route === 'settings') return <SettingsPage />
  return <OverviewPage />
}

function PageLoading({ route }: { route: AppRoute }): React.JSX.Element {
  if (route === 'documents') {
    return (
      <div className="h-[calc(100vh-3.25rem)] animate-pulse bg-[#f3f7f6] motion-reduce:animate-none" />
    )
  }
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="panel h-48 animate-pulse bg-white motion-reduce:animate-none" />
    </div>
  )
}
