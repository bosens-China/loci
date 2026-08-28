import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import type { CloudAdminClient, LocalRuntime } from '@loci/runtime'
import type { ServerCrawlSettings } from '@loci/shared'
import { registerAdminCrawlSettings } from '../admin-crawl-settings.js'

describe('CLI Server 抓取策略', () => {
  it('读取当前修订并只覆盖显式提供的字段', async () => {
    const current: ServerCrawlSettings = {
      maxConcurrentJobs: 3,
      httpConcurrency: 9,
      browserConcurrency: 5,
      batchIntervalMinSeconds: 0,
      batchIntervalMaxSeconds: 0,
      revision: 4,
      updatedAt: '2026-08-28T00:00:00.000Z'
    }
    const getCrawlSettings = vi.fn(async () => current)
    const saveCrawlSettings = vi.fn(async (input) => ({
      ...input,
      revision: input.revision + 1,
      updatedAt: '2026-08-28T00:01:00.000Z'
    }))
    const client = { getCrawlSettings, saveCrawlSettings } as unknown as CloudAdminClient
    const program = new Command().exitOverride()
    registerAdminCrawlSettings(program, async (_title, action) => {
      await action(client, {} as LocalRuntime)
    })

    await program.parseAsync(['settings-set', '--max-jobs', '4', '--interval', '100-300'], {
      from: 'user'
    })

    expect(saveCrawlSettings).toHaveBeenCalledWith({
      maxConcurrentJobs: 4,
      httpConcurrency: 9,
      browserConcurrency: 5,
      batchIntervalMinSeconds: 100,
      batchIntervalMaxSeconds: 300,
      revision: 4
    })
  })
})
