export type BrowserOperationKind = 'install' | 'uninstall'
export type BrowserOperationState = 'running' | 'succeeded' | 'failed'
export type BrowserOperationPhase =
  'preparing' | 'downloading' | 'installing' | 'validating' | 'removing'

export interface BrowserOperationStatus {
  id: string
  kind: BrowserOperationKind
  state: BrowserOperationState
  phase: BrowserOperationPhase
  progress: number | null
  message: string
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export interface LocalBrowserStatus {
  installed: boolean
  launchable: boolean | null
  executablePath: string
  chromiumVersion: string | null
  playwrightVersion: string
  checkedAt: string | null
  error: string | null
  operation: BrowserOperationStatus | null
}

export type ServerBrowserProvider = 'disabled' | 'local' | 'browserless'

export interface ServerBrowserStatus {
  provider: ServerBrowserProvider
  available: boolean
  chromiumVersion: string | null
  playwrightVersion: string
  endpoint: string | null
  checkedAt: string
  error: string | null
}
