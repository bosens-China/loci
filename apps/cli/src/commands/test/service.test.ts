import { describe, expect, it, vi } from 'vitest'
import type { LocalServiceState } from '@loci/runtime'
import type { DocumentSource } from '@loci/shared'
import { runUiSession, type UiSessionDependencies } from '../service.js'

const state: LocalServiceState = {
  pid: 42,
  port: 43123,
  controlToken: 'control-token',
  startedAt: '2026-08-20T00:00:00.000Z'
}

const source: DocumentSource = {
  id: 'source-1',
  name: 'Docs',
  url: 'https://example.com/docs',
  mode: 'auto',
  status: 'healthy',
  pages: 1,
  contentSize: 10,
  pageLimit: 1000,
  scopePath: '/',
  lastUpdated: '刚刚',
  schedule: null,
  httpConcurrency: null,
  browserConcurrency: null,
  iconUrl: null,
  cloud: null,
  kind: 'web',
  githubArchiveLimitMb: null,
  githubMarkdownLimitMb: null,
  githubDefaultBranch: null,
  githubRevision: null
}

function createSession(
  events: string[],
  browserOpened = true,
  initialSources: DocumentSource[] = []
): { dependencies: UiSessionDependencies; sources: DocumentSource[]; terminate: () => void } {
  let terminate = (): void => undefined
  const termination = new Promise<void>((resolvePromise) => {
    terminate = resolvePromise
  })
  const sources = [...initialSources]
  const dependencies: UiSessionDependencies = {
    startService: async () => ({
      state,
      listSources: () => sources,
      close: async () => {
        events.push('close')
      }
    }),
    createWebSession: async () => 'launch token',
    printAddress: (url) => events.push(`address:${url}`),
    openBrowser: async (url) => {
      events.push(`open:${url}`)
      return browserOpened
    },
    reportBrowserOpenFailure: () => events.push('open-failed'),
    reportReady: () => events.push('ready'),
    waitForTermination: () => {
      events.push('listen')
      return termination
    },
    wasBackgroundServiceInstalled: async () => false,
    ensureBackgroundService: async () => {
      events.push('ensure-background')
    },
    reportHandoffStart: () => events.push('handoff-start'),
    reportHandoffSuccess: () => events.push('handoff-success'),
    reportHandoffFailure: () => events.push('handoff-failure')
  }
  return { dependencies, sources, terminate }
}

describe('loci ui foreground session', () => {
  it('先输出地址再打开浏览器，并在终止后关闭服务', async () => {
    const events: string[] = []
    const session = createSession(events)

    const result = runUiSession({ open: true }, session.dependencies)
    await vi.waitFor(() => expect(events).toContain('ready'))

    const url = 'http://127.0.0.1:43123/#token=launch%20token'
    expect(events).not.toContain('close')
    session.terminate()
    await result
    expect(events).toEqual(['listen', `address:${url}`, `open:${url}`, 'ready', 'close'])
  })

  it('浏览器打开失败时提示手动打开并继续等待', async () => {
    const events: string[] = []
    const session = createSession(events, false)

    const result = runUiSession({ open: true }, session.dependencies)
    await vi.waitFor(() => expect(events).toContain('ready'))
    expect(events).not.toContain('close')
    session.terminate()
    await result

    expect(events).toEqual([
      'listen',
      'address:http://127.0.0.1:43123/#token=launch%20token',
      'open:http://127.0.0.1:43123/#token=launch%20token',
      'open-failed',
      'ready',
      'close'
    ])
  })

  it('--no-open 跳过浏览器但仍保持前台会话', async () => {
    const events: string[] = []
    const session = createSession(events)
    const dependencies = session.dependencies
    dependencies.openBrowser = vi.fn(dependencies.openBrowser)

    const result = runUiSession({ open: false }, dependencies)
    await vi.waitFor(() => expect(events).toContain('ready'))

    expect(dependencies.openBrowser).not.toHaveBeenCalled()
    expect(events).not.toContain('close')
    session.terminate()
    await result
    expect(events).toEqual([
      'listen',
      'address:http://127.0.0.1:43123/#token=launch%20token',
      'ready',
      'close'
    ])
  })

  it('浏览器启动抛错时仍会等待并只关闭一次服务', async () => {
    const events: string[] = []
    const session = createSession(events)
    const dependencies = session.dependencies
    dependencies.openBrowser = async () => {
      events.push('open')
      throw new Error('no desktop session')
    }

    const result = runUiSession({ open: true }, dependencies)
    await vi.waitFor(() => expect(events).toContain('ready'))
    expect(events).not.toContain('close')
    session.terminate()
    await result

    expect(events).toEqual([
      'listen',
      'address:http://127.0.0.1:43123/#token=launch%20token',
      'open',
      'open-failed',
      'ready',
      'close'
    ])
  })

  it('会话中新开启定时能力时先关闭前台服务再交接后台服务', async () => {
    const events: string[] = []
    const session = createSession(events)
    const result = runUiSession({ open: false }, session.dependencies)
    await vi.waitFor(() => expect(events).toContain('ready'))

    session.sources.push({ ...source, schedule: '0 2 * * *' })
    session.terminate()
    await result

    expect(events.slice(-4)).toEqual([
      'close',
      'handoff-start',
      'ensure-background',
      'handoff-success'
    ])
  })

  it('恢复为了 Web UI 暂停的已安装服务', async () => {
    const events: string[] = []
    const session = createSession(events, true, [{ ...source, schedule: '0 2 * * *' }])
    session.dependencies.wasBackgroundServiceInstalled = async () => true

    const result = runUiSession({ open: false }, session.dependencies)
    await vi.waitFor(() => expect(events).toContain('ready'))
    session.terminate()
    await result

    expect(events).toContain('ensure-background')
  })

  it('最后一个持久需求被关闭时不恢复后台服务', async () => {
    const events: string[] = []
    const session = createSession(events, true, [{ ...source, schedule: '0 2 * * *' }])
    session.dependencies.wasBackgroundServiceInstalled = async () => true

    const result = runUiSession({ open: false }, session.dependencies)
    await vi.waitFor(() => expect(events).toContain('ready'))
    session.sources[0] = { ...source, schedule: null }
    session.terminate()
    await result

    expect(events).not.toContain('ensure-background')
  })

  it('交接失败时保留正常退出并给出恢复提示', async () => {
    const events: string[] = []
    const session = createSession(events)
    session.dependencies.ensureBackgroundService = async () => {
      throw new Error('service unavailable')
    }
    const result = runUiSession({ open: false }, session.dependencies)
    await vi.waitFor(() => expect(events).toContain('ready'))

    session.sources.push({ ...source, schedule: '0 2 * * *' })
    session.terminate()
    await expect(result).resolves.toBeUndefined()

    expect(events.slice(-3)).toEqual(['close', 'handoff-start', 'handoff-failure'])
  })
})
