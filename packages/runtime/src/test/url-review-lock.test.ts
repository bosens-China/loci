import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { retryDelay } = vi.hoisted(() => ({ retryDelay: vi.fn() }))

vi.mock('node:timers/promises', () => ({ setTimeout: retryDelay }))

import { acquireCrawlRuntimeLock } from '../runtime-lock.js'
import { acquireUrlReviewRuntimeLock } from '../url-review-lock.js'

const directories: string[] = []

afterEach(() => {
  retryDelay.mockReset()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('URL Review runtime lock', () => {
  it('超过旧轮询上限后仍继续等待同一来源锁', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-url-review-lock-'))
    directories.push(directory)
    const existing = acquireCrawlRuntimeLock(directory, 'source-1', 'existing crawl')
    let waits = 0
    retryDelay.mockImplementation(async () => {
      waits += 1
      if (waits === 300) existing.release()
    })

    const acquired = await acquireUrlReviewRuntimeLock({
      dataDir: directory,
      sourceId: 'source-1',
      owner: 'review',
      shouldContinue: () => true
    })

    expect(waits).toBe(300)
    expect(acquired).toBeDefined()
    acquired?.release()
  })
})
