import { describe, expect, it, vi } from 'vitest'
import type { LocalWebServiceState } from '@loci/runtime'
import { runUiSession, type UiSessionDependencies } from '../service.js'

const state: LocalWebServiceState = {
  pid: 42,
  port: 43123,
  startedAt: '2026-08-20T00:00:00.000Z'
}

function createSession(
  events: string[],
  browserOpened = true
): { dependencies: UiSessionDependencies; terminate: () => void } {
  let terminate = (): void => undefined
  const termination = new Promise<void>((resolvePromise) => {
    terminate = resolvePromise
  })
  const dependencies: UiSessionDependencies = {
    startService: async () => ({
      state,
      close: async () => {
        events.push('close')
      }
    }),
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
    }
  }
  return { dependencies, terminate }
}

describe('loci ui foreground session', () => {
  it('先输出地址再打开浏览器，并在终止后关闭服务', async () => {
    const events: string[] = []
    const session = createSession(events)

    const result = runUiSession({ open: true }, session.dependencies)
    await vi.waitFor(() => expect(events).toContain('ready'))

    const url = 'http://127.0.0.1:43123/'
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
      'address:http://127.0.0.1:43123/',
      'open:http://127.0.0.1:43123/',
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
    expect(events).toEqual(['listen', 'address:http://127.0.0.1:43123/', 'ready', 'close'])
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
      'address:http://127.0.0.1:43123/',
      'open',
      'open-failed',
      'ready',
      'close'
    ])
  })
})
