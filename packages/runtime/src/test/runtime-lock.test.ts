import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireCrawlRuntimeLock,
  acquireMaintenanceRuntimeLock,
  acquireRuntimeLock,
  readRuntimeLock,
  RuntimeLockedError
} from '../runtime-lock.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createDataDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'loci-lock-'))
  directories.push(directory)
  return directory
}

describe('runtime lock', () => {
  it('prevents two processes from owning the same logical lock', () => {
    const dataDir = createDataDir()
    const lock = acquireRuntimeLock(dataDir, 'mcp', '第一个进程')

    expect(() => acquireRuntimeLock(dataDir, 'mcp', '第二个进程')).toThrow(RuntimeLockedError)
    expect(readRuntimeLock(dataDir, 'mcp')).toMatchObject({ owner: '第一个进程' })

    lock.release()
    expect(readRuntimeLock(dataDir, 'mcp')).toBeNull()
  })

  it('uses the same atomic lock across real Node processes', async () => {
    const dataDir = createDataDir()
    const moduleUrl = pathToFileURL(resolve('src/runtime-lock.ts')).href
    const script = `
      import { acquireRuntimeLock } from ${JSON.stringify(moduleUrl)}
      const lock = acquireRuntimeLock(${JSON.stringify(dataDir)}, 'crawl-vite', '子进程')
      process.stdout.write('locked\\n')
      process.stdin.once('data', () => { lock.release(); process.exit(0) })
    `
    const child = spawn(
      process.execPath,
      ['--experimental-transform-types', '--input-type=module', '--eval', script],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    await once(child.stdout!, 'data')

    expect(() => acquireRuntimeLock(dataDir, 'crawl-vite', '父进程')).toThrow(RuntimeLockedError)
    child.stdin!.write('release')
    await once(child, 'exit')

    const lock = acquireRuntimeLock(dataDir, 'crawl-vite', '父进程')
    lock.release()
  })

  it('keeps full-database maintenance and crawling mutually exclusive', () => {
    const dataDir = createDataDir()
    const crawl = acquireCrawlRuntimeLock(dataDir, 'react', 'CLI')

    expect(() => acquireMaintenanceRuntimeLock(dataDir, '桌面端导入')).toThrow('仍有文档源正在同步')

    crawl.release()
    const maintenance = acquireMaintenanceRuntimeLock(dataDir, '桌面端导入')
    expect(() => acquireCrawlRuntimeLock(dataDir, 'react', 'CLI')).toThrow(
      '数据库正在由桌面端导入维护'
    )
    maintenance.release()
  })
})
