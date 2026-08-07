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

  it('失败任务清理后允许同一文档源安全重试', async () => {
    const coordinator = new CrawlTaskCoordinator()
    const firstStart = vi.fn(async () => {
      throw new Error('临时失败')
    })
    await expect(coordinator.run('vite', firstStart)).rejects.toThrow('临时失败')
    await vi.waitFor(() => expect(coordinator.isRunning('vite')).toBe(false))

    const retryStart = vi.fn(async () => progress)
    await expect(coordinator.run('vite', retryStart)).resolves.toEqual(progress)
    expect(retryStart).toHaveBeenCalledOnce()
  })

  it('不同文档源拥有独立任务并可同时运行', async () => {
    const coordinator = new CrawlTaskCoordinator()
    let finishVite!: (value: CrawlProgress) => void
    let finishVue!: (value: CrawlProgress) => void
    const vite = coordinator.run(
      'vite',
      () => new Promise<CrawlProgress>((resolve) => (finishVite = resolve))
    )
    const vue = coordinator.run(
      'vue',
      () => new Promise<CrawlProgress>((resolve) => (finishVue = resolve))
    )
    await vi.waitFor(() => {
      expect(coordinator.isRunning('vite')).toBe(true)
      expect(coordinator.isRunning('vue')).toBe(true)
    })
    finishVite(progress)
    finishVue(progress)
    await Promise.all([vite, vue])
  })
})
