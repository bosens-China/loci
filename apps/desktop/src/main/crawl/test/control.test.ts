import { describe, expect, it } from 'vitest'
import { CrawlControl } from '../control'

describe('CrawlControl', () => {
  it('取消时唤醒暂停、打断等待，并在任务收尾后允许删除', async () => {
    const control = new CrawlControl()
    control.pause()
    const paused = control.waitIfPaused()
    const delayed = control.waitForDelay(60_000)

    control.cancel()

    await expect(paused).rejects.toThrow('抓取已取消')
    await expect(delayed).rejects.toThrow('抓取已取消')
    control.finish()
    await expect(control.done).resolves.toBeUndefined()
  })
})
