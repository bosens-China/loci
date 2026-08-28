import * as z from 'zod/v4'
import {
  SERVER_CRAWL_SETTINGS_LIMITS,
  isValidBatchIntervalRange,
  isValidBatchIntervalSeconds
} from '@loci/shared'
import { remoteReadAnnotations, result, writeAnnotations } from './server-support.js'
import type { LociMcpServices } from './services.js'
import type { LociToolRegistrar } from './tool-registry.js'

const values = {
  max_concurrent_jobs: z
    .number()
    .int()
    .min(SERVER_CRAWL_SETTINGS_LIMITS.maxConcurrentJobs.min)
    .max(SERVER_CRAWL_SETTINGS_LIMITS.maxConcurrentJobs.max),
  http_concurrency: z
    .number()
    .int()
    .min(SERVER_CRAWL_SETTINGS_LIMITS.concurrency.min)
    .max(SERVER_CRAWL_SETTINGS_LIMITS.concurrency.max),
  browser_concurrency: z
    .number()
    .int()
    .min(SERVER_CRAWL_SETTINGS_LIMITS.concurrency.min)
    .max(SERVER_CRAWL_SETTINGS_LIMITS.concurrency.max),
  batch_interval_min_seconds: z.number().int().refine(isValidBatchIntervalSeconds),
  batch_interval_max_seconds: z.number().int().refine(isValidBatchIntervalSeconds),
  revision: z.number().int().positive()
} as const

const outputSchema = z.object({ settings: z.record(z.string(), z.unknown()) })

/** Server 全局抓取策略单独使用 Server 前缀，避免与本地 AppSettings 混淆。 */
export function registerServerCrawlSettingsTools(
  register: LociToolRegistrar,
  services: LociMcpServices
): void {
  register(
    'loci_get_server_crawl_settings',
    {
      title: '读取 Server 抓取策略',
      description: '读取 Server 全局任务并发、页面并发和批次间隔；同 hostname 始终串行。',
      inputSchema: z.object({}).strict(),
      outputSchema,
      annotations: remoteReadAnnotations()
    },
    async () =>
      result({ settings: await services.getServerCrawlSettings() }, 'Server 抓取策略读取完成')
  )

  register(
    'loci_save_server_crawl_settings',
    {
      title: '保存 Server 抓取策略',
      description: '按修订号保存 Server 全局策略；降低并发不会终止正在运行的任务。',
      inputSchema: z
        .object(values)
        .strict()
        .refine(
          (input) =>
            isValidBatchIntervalRange(
              input.batch_interval_min_seconds,
              input.batch_interval_max_seconds
            ),
          { message: '批次间隔最小值不能大于最大值' }
        ),
      outputSchema,
      annotations: writeAnnotations(false)
    },
    async (input) =>
      result(
        {
          settings: await services.saveServerCrawlSettings({
            maxConcurrentJobs: input.max_concurrent_jobs,
            httpConcurrency: input.http_concurrency,
            browserConcurrency: input.browser_concurrency,
            batchIntervalMinSeconds: input.batch_interval_min_seconds,
            batchIntervalMaxSeconds: input.batch_interval_max_seconds,
            revision: input.revision
          })
        },
        'Server 抓取策略已保存'
      )
  )
}
