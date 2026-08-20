import { lazy, Suspense, useEffect, useState } from 'react'
import { Button, Result } from 'antd'
import { exchangeLaunchToken, readLaunchToken, verifySession } from '@/api/session'
import { AppShell } from '@/components/AppShell'
import { useJobEvents } from '@/hooks/use-job-events'
import { resolveRoute, routePath, type AppRoute } from '@/routing'

const OverviewPage = lazy(() =>
  import('@/pages/OverviewPage').then((module) => ({ default: module.OverviewPage }))
)
const SourcesPage = lazy(() =>
  import('@/pages/SourcesPage').then((module) => ({ default: module.SourcesPage }))
)
const LibraryPage = lazy(() =>
  import('@/pages/LibraryPage').then((module) => ({ default: module.LibraryPage }))
)
const CloudPage = lazy(() =>
  import('@/pages/CloudPage').then((module) => ({ default: module.CloudPage }))
)
const JobsPage = lazy(() =>
  import('@/pages/JobsPage').then((module) => ({ default: module.JobsPage }))
)
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
)

type SessionState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; error: Error }

export function App(): React.JSX.Element {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [route, setRoute] = useState<AppRoute>(() => resolveRoute(window.location.pathname))
  const retryAuthentication = (): void => {
    setSession({ status: 'loading' })
    void authenticateSession()
      .then(() => {
        setSession({ status: 'ready' })
      })
      .catch((error: unknown) => setSession({ status: 'error', error: toError(error) }))
  }
  useEffect(() => {
    void authenticateSession()
      .then(() => setSession({ status: 'ready' }))
      .catch((error: unknown) => setSession({ status: 'error', error: toError(error) }))
  }, [])
  useEffect(() => {
    const update = (): void => setRoute(resolveRoute(window.location.pathname))
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  useJobEvents(session.status === 'ready')

  if (session.status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-3 border-[#bdd2d2] border-t-[#0a7c86] motion-reduce:animate-none" />
          <div className="mt-4 text-sm text-[#5f7375]">正在连接本地服务…</div>
        </div>
      </div>
    )
  }
  if (session.status === 'error') {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <Result
          status="403"
          title="需要新的本地会话"
          subTitle={session.error.message}
          extra={
            <div className="flex justify-center gap-2">
              <Button onClick={retryAuthentication}>重试</Button>
              <Button type="primary" onClick={() => void navigator.clipboard.writeText('loci ui')}>
                复制 loci ui
              </Button>
            </div>
          }
        />
      </div>
    )
  }
  const navigate = (next: AppRoute): void => {
    window.history.pushState({}, '', routePath(next))
    setRoute(next)
  }
  return (
    <AppShell route={route} onNavigate={navigate}>
      <Suspense fallback={<PageLoading />}>{pageFor(route)}</Suspense>
    </AppShell>
  )
}

function pageFor(route: AppRoute): React.JSX.Element {
  if (route === 'sources') return <SourcesPage />
  if (route === 'library') return <LibraryPage />
  if (route === 'cloud') return <CloudPage />
  if (route === 'jobs') return <JobsPage />
  if (route === 'settings') return <SettingsPage />
  return <OverviewPage />
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('本地服务会话建立失败')
}

async function authenticateSession(): Promise<void> {
  const token = readLaunchToken()
  if (token) {
    await exchangeLaunchToken(token)
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`)
  } else {
    await verifySession()
  }
}

function PageLoading(): React.JSX.Element {
  return (
    <div
      className="panel h-48 animate-pulse bg-white/70 motion-reduce:animate-none"
      aria-label="正在加载页面"
    />
  )
}
