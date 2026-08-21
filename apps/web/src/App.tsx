import { lazy, Suspense, useEffect, useState } from 'react'
import { exchangeLaunchToken, readLaunchToken, verifySession } from '@/api/session'
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
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
)

type SessionState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; error: Error }

export function App(): React.JSX.Element {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [route, setRoute] = useState<AppRoute>(() => {
    migrateLegacyDocumentPath(window.location.pathname)
    return resolveRoute(window.location.pathname)
  })

  useEffect(() => {
    void authenticateSession()
      .then(() => setSession({ status: 'ready' }))
      .catch((error: unknown) => setSession({ status: 'error', error: toError(error) }))
  }, [])
  useEffect(() => {
    const update = (): void => {
      migrateLegacyDocumentPath(window.location.pathname)
      setRoute(resolveRoute(window.location.pathname))
    }
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  useJobEvents(session.status === 'ready')

  if (session.status === 'loading') {
    return (
      <div className="grid min-h-screen min-w-1200px place-items-center bg-canvas">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-3 border-[#bdd2d2] border-t-accent motion-reduce:animate-none" />
          <div className="mt-3 text-sm text-muted">正在连接本地服务…</div>
        </div>
      </div>
    )
  }
  if (session.status === 'error') {
    return <SessionError error={session.error} onRetry={() => void retry(setSession)} />
  }

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

function SessionError(props: { error: Error; onRetry: () => void }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copyCommand = (): void => {
    void navigator.clipboard.writeText('loci ui').then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="grid min-h-screen min-w-1200px place-items-center bg-canvas px-8">
      <div className="panel max-w-md p-8 text-center">
        <div className="font-serif text-2xl text-ink">需要新的本地会话</div>
        <p className="mt-3 text-sm leading-6 text-muted">{props.error.message}</p>
        <p className="mt-2 text-sm text-muted">在终端运行以下命令重新打开控制台：</p>
        <code className="mt-4 block rounded-lg bg-[#edf3f2] px-4 py-3 font-mono text-sm text-ink">
          loci ui
        </code>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            className="focus-ring rounded-lg border border-[#d8e0e0] bg-white px-4 py-2 text-sm font-600 text-ink transition-colors hover:bg-[#f3f7f6]"
            onClick={props.onRetry}
          >
            重试
          </button>
          <button
            type="button"
            className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-600 text-white transition-colors hover:bg-[#086570]"
            onClick={copyCommand}
          >
            {copied ? '已复制' : '复制命令'}
          </button>
        </div>
      </div>
    </div>
  )
}

function pageFor(route: AppRoute): React.JSX.Element {
  if (route === 'documents') return <DocumentsPage />
  if (route === 'cloud') return <CloudPage />
  if (route === 'jobs') return <JobsPage />
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

function retry(setSession: (state: SessionState) => void): void {
  setSession({ status: 'loading' })
  void authenticateSession()
    .then(() => setSession({ status: 'ready' }))
    .catch((error: unknown) => setSession({ status: 'error', error: toError(error) }))
}
