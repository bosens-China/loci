import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireMaintenanceRuntimeLock,
  acquireRuntimeLock,
  readRuntimeLock,
  RuntimeLockedError
} from '../runtime-lock.js'

const roots: string[] = []
const children: Array<{ process: ChildProcess; exited: Promise<unknown> }> = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.process.exitCode === null && child.process.signalCode === null)
      child.process.kill('SIGKILL')
    await child.exited
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function directory() {
  const root = mkdtempSync(join(tmpdir(), 'loci-lock-process-'))
  roots.push(root)
  return root
}

function contender(root: string, beforeImport = '') {
  const moduleUrl = pathToFileURL(resolve('src/runtime-lock.ts')).href
  const script = `
    import fs from 'node:fs'
    import { syncBuiltinESMExports } from 'node:module'
    ${beforeImport}
    const { acquireRuntimeLock, RuntimeLockedError } = await import(${JSON.stringify(moduleUrl)})
    try {
      const lock = acquireRuntimeLock(${JSON.stringify(root)}, 'crawl-review', '子进程')
      process.send('acquired')
      process.once('message', () => { lock.release(); process.exit(0) })
    } catch (error) {
      process.send(error instanceof RuntimeLockedError ? 'blocked' : String(error))
      process.exit(error instanceof RuntimeLockedError ? 0 : 1)
    }
  `
  const child = spawn(
    process.execPath,
    ['--experimental-transform-types', '--input-type=module', '--eval', script],
    {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    }
  )
  const exited = once(child, 'exit')
  children.push({ process: child, exited })
  const result = once(child, 'message').then(([message]: unknown[]) => message)
  return { process: child, exited, result }
}

describe('文件锁跨进程竞争', () => {
  it('初始化尚未写入记录时只能有一个进程获得资源，失败方可重试', async () => {
    const root = directory()
    const ready = join(root, 'ready')
    const proceed = join(root, 'proceed')
    const child = contender(
      root,
      `
      const write = fs.writeFileSync
      fs.writeFileSync = (file, data, options) => {
        // 在真实文件创建与内容写入之间暂停子进程，放大初始化竞争窗口。
        const descriptor = typeof file === 'number' ? file : fs.openSync(file, 'wx', 0o600)
        write(${JSON.stringify(ready)}, 'ready')
        while (!fs.existsSync(${JSON.stringify(proceed)})) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
        }
        try { write(descriptor, data, options) }
        finally { if (typeof file !== 'number') fs.closeSync(descriptor) }
      }
      syncBuiltinESMExports()
    `
    )
    await vi.waitFor(() => expect(existsSync(ready)).toBe(true))
    const parent = acquireRuntimeLock(root, 'crawl-review', '父进程')
    try {
      writeFileSync(proceed, 'continue')
      expect(await child.result).toBe('blocked')
      await child.exited
      expect(readRuntimeLock(root, 'crawl-review')).toMatchObject({ owner: '父进程' })
    } finally {
      parent.release()
    }
    const retry = contender(root)
    expect(await retry.result).toBe('acquired')
    retry.process.send('release')
    await retry.exited
    expect(readRuntimeLock(root, 'crawl-review')).toBeNull()
  })

  it('进程崩溃后多个回收者同时重试，只允许一个新持有者', async () => {
    const root = directory()
    const previous = contender(root)
    expect(await previous.result).toBe('acquired')
    previous.process.kill('SIGKILL')
    await previous.exited
    expect(readRuntimeLock(root, 'crawl-review')).toBeNull()

    const rivals = Array.from({ length: 4 }, () => contender(root))
    const results = await Promise.all(rivals.map((rival) => rival.result))
    expect(results.filter((value) => value === 'acquired')).toHaveLength(1)
    expect(results.filter((value) => value === 'blocked')).toHaveLength(3)
    const winner = rivals[results.indexOf('acquired')]!
    expect(readRuntimeLock(root, 'crawl-review')?.pid).toBe(winner.process.pid)
    winner.process.kill('SIGKILL')
    await winner.exited
    const recovered = acquireRuntimeLock(root, 'crawl-review', '恢复')
    recovered.release()
  })

  it('回收旧锁期间其他进程不能抢先发布再被回收者误删', async () => {
    const root = directory()
    const previous = contender(root)
    expect(await previous.result).toBe('acquired')
    previous.process.kill('SIGKILL')
    await previous.exited
    const ready = join(root, 'reaping')
    const proceed = join(root, 'proceed')
    const first = contender(
      root,
      `
      const unlink = fs.unlinkSync
      fs.unlinkSync = (path) => {
        if (String(path).endsWith('crawl-review.lock')) {
          fs.writeFileSync(${JSON.stringify(ready)}, 'ready')
          while (!fs.existsSync(${JSON.stringify(proceed)})) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
          }
        }
        return unlink(path)
      }
      syncBuiltinESMExports()
    `
    )
    await vi.waitFor(() => expect(existsSync(ready)).toBe(true))
    const second = contender(root, `process.send('started')`)
    expect(await second.result).toBe('started')
    const secondResult = once(second.process, 'message').then(([message]: unknown[]) => message)
    writeFileSync(proceed, 'continue')
    const results = await Promise.all([first.result, secondResult])
    expect(results.filter((result) => result === 'acquired')).toHaveLength(1)
    expect(results.filter((result) => result === 'blocked')).toHaveLength(1)
  })

  it('无法确认旧版空锁的持有者时保守拒绝抓取和维护，不删除锁', () => {
    const root = directory()
    mkdirSync(join(root, 'locks'))
    const path = join(root, 'locks', 'crawl-review.lock')
    writeFileSync(path, '')
    expect(() => acquireRuntimeLock(root, 'crawl-review', '竞争者')).toThrow(RuntimeLockedError)
    expect(() => acquireMaintenanceRuntimeLock(root, '维护')).toThrow(RuntimeLockedError)
    expect(readFileSync(path, 'utf8')).toBe('')
    expect(readRuntimeLock(root, 'maintenance')).toBeNull()
  })
})
