import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserManager } from '../browser-manager.js'
import { acquireCrawlRuntimeLock } from '../runtime-lock.js'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('BrowserManager', () => {
  it('同一进程重复安装复用当前操作并持续发布进度', async () => {
    const root = temporaryRoot()
    let finish: (() => void) | undefined
    const runCommand = vi.fn(
      async (
        _path: string,
        _command: 'install' | 'uninstall',
        onProgress?: (value: { progress: number | null; message: string }) => void
      ) => {
        onProgress?.({ progress: 45, message: '正在下载' })
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      }
    )
    const changes: number[] = []
    const subscriptions: number[] = []
    const manager = new BrowserManager({
      browsersPath: join(root, 'playwright'),
      lockRoot: root,
      owner: '测试',
      runCommand,
      verify: async () => verification(true),
      onChange: (operation) => {
        if (operation.progress !== null) changes.push(operation.progress)
      }
    })
    const unsubscribe = manager.subscribe((operation) => {
      if (operation.progress !== null) subscriptions.push(operation.progress)
    })

    const first = manager.start('install')
    const second = manager.start('install')

    expect(second.id).toBe(first.id)
    expect(runCommand).toHaveBeenCalledOnce()
    expect(() => manager.start('uninstall')).toThrow('正在安装')
    expect((await manager.getStatus()).operation).toMatchObject({ progress: 45 })

    const waiting = manager.waitForCurrent()
    finish?.()
    await waiting
    expect((await manager.getStatus()).operation).toMatchObject({ state: 'succeeded' })
    expect(changes).toContain(45)
    expect(subscriptions).toContain(45)
    unsubscribe()
  })

  it('跨进程管理锁阻止另一个实例并发操作', async () => {
    const root = temporaryRoot()
    let finish: (() => void) | undefined
    const first = new BrowserManager({
      browsersPath: join(root, 'playwright'),
      lockRoot: root,
      owner: '第一个实例',
      runCommand: async () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
      verify: async () => verification(true)
    })
    const second = new BrowserManager({
      browsersPath: join(root, 'playwright'),
      lockRoot: root,
      owner: '第二个实例',
      runCommand: async () => undefined,
      verify: async () => verification(true)
    })

    first.start('install')
    expect(() => second.start('uninstall')).toThrow('第一个实例安装无头浏览器')
    const waiting = first.waitForCurrent()
    finish?.()
    await waiting
  })

  it('活动抓取存在时在创建卸载操作前拒绝执行', () => {
    const root = temporaryRoot()
    const manager = new BrowserManager({
      browsersPath: join(root, 'playwright'),
      lockRoot: root,
      owner: '测试',
      assertCanUninstall: () => {
        throw new Error('仍有文档抓取任务正在使用浏览器')
      }
    })

    expect(() => manager.start('uninstall')).toThrow('仍有文档抓取任务')
  })

  it('卸载锁生效后拒绝新的抓取穿透', async () => {
    const root = temporaryRoot()
    let finish: (() => void) | undefined
    const manager = new BrowserManager({
      browsersPath: join(root, 'playwright'),
      lockRoot: join(root, 'cache'),
      usageLockRoot: join(root, 'data'),
      owner: '测试',
      runCommand: async () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
      verify: async () => verification(false)
    })

    manager.start('uninstall')
    expect(() => acquireCrawlRuntimeLock(join(root, 'data'), 'source-1', '测试抓取')).toThrow(
      '操作正在由测试卸载无头浏览器执行'
    )
    const waiting = manager.waitForCurrent()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish?.()
    await waiting

    const crawlLock = acquireCrawlRuntimeLock(join(root, 'data'), 'source-1', '测试抓取')
    crawlLock.release()
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'loci-browser-manager-'))
  roots.push(root)
  return root
}

function verification(installed: boolean): {
  installed: boolean
  executable: string
  launchable: boolean
  chromiumVersion: string | null
  playwrightVersion: string
  error: string | null
} {
  return {
    installed,
    executable: '/tmp/headless-shell',
    launchable: installed,
    chromiumVersion: installed ? '133.0' : null,
    playwrightVersion: '1.62.0',
    error: null
  }
}
