import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserOperationStatus, LocalBrowserStatus } from '@loci/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocalHttpServer } from '../local-http-server.js'
import { createLocalRuntime } from '../local-runtime.js'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

describe('本机浏览器 HTTP API', () => {
  it('查询状态并异步接受安装和卸载操作', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-browser-'))
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    })
    const operation = browserOperation()
    const status = browserStatus(operation)
    vi.spyOn(runtime.browserManager, 'getStatus').mockResolvedValue(status)
    const start = vi.spyOn(runtime.browserManager, 'start').mockReturnValue(operation)
    const server = await startLocalHttpServer(runtime, {})
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    })

    const queried = await fetch(`${server.endpoint}/api/browser`)
    expect(queried.status).toBe(200)
    expect(await queried.json()).toMatchObject({ playwrightVersion: '1.62.0' })

    const installed = await fetch(`${server.endpoint}/api/browser/install`, {
      method: 'POST',
      headers: { Origin: server.endpoint }
    })
    expect(installed.status).toBe(202)
    expect(start).toHaveBeenCalledWith('install')

    const uninstalled = await fetch(`${server.endpoint}/api/browser`, {
      method: 'DELETE',
      headers: { Origin: server.endpoint }
    })
    expect(uninstalled.status).toBe(202)
    expect(start).toHaveBeenCalledWith('uninstall')
  })
})

function browserStatus(operation: BrowserOperationStatus): LocalBrowserStatus {
  return {
    installed: false,
    launchable: false,
    executablePath: '/tmp/headless-shell',
    chromiumVersion: null,
    playwrightVersion: '1.62.0',
    checkedAt: '2026-08-28T00:00:00.000Z',
    error: null,
    operation
  }
}

function browserOperation(): BrowserOperationStatus {
  return {
    id: 'browser-operation',
    kind: 'install',
    state: 'running',
    phase: 'downloading',
    progress: 45,
    message: '正在下载',
    startedAt: '2026-08-28T00:00:00.000Z',
    finishedAt: null,
    error: null
  }
}
