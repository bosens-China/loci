import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
