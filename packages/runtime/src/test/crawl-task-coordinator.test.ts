import { describe, expect, it, vi } from 'vitest'
import type { CrawlProgress } from '@loci/shared'
import { CrawlTaskCoordinator } from '../crawl-task-coordinator.js'

const progress: CrawlProgress = {
  queued: 2,
  processed: 1,
  succeeded: 1,
  failed: 0,
  limitReached: false
}

describe('CrawlTaskCoordinator', () => {
  it('复用同一文档源任务并向后加入的调用者重放最近进度', async () => {
    const coordinator = new CrawlTaskCoordinator()
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    let report!: (value: CrawlProgress) => void
    let finish!: (value: CrawlProgress) => void
    const start = vi.fn(
      (onProgress: (value: CrawlProgress) => void) =>
        new Promise<CrawlProgress>((resolve) => {
          report = onProgress
          finish = resolve
        })
    )

    const first = coordinator.run('vite', start, firstListener)
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
    report(progress)
    const second = coordinator.run('vite', start, secondListener)

    expect(second).toBe(first)
    expect(start).toHaveBeenCalledOnce()
    expect(firstListener).toHaveBeenLastCalledWith(progress)
    expect(secondListener).toHaveBeenCalledWith(progress)
    expect(coordinator.isRunning('vite')).toBe(true)

    finish({ ...progress, processed: 2, succeeded: 2 })
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ...progress, processed: 2, succeeded: 2 },
      { ...progress, processed: 2, succeeded: 2 }
    ])
    expect(coordinator.isRunning('vite')).toBe(false)
  })
})
