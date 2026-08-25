import * as z from 'zod/v4'
import { fetchPagesOutputSchema } from './schemas.js'
import type { LociMcpServices } from './services.js'
import { failure, result, serializeProgress } from './server-support.js'
import type { LociToolContext, LociToolRegistrar } from './tool-registry.js'

const annotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true
}

/** 注册精确页面 upsert；该工具不执行站点发现，也不跟随页面链接。 */
export function registerPageTools(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_fetch_pages',
    {
      title: '抓取或更新指定页面',
      description:
        '把同一网页文档库下的指定 URL 插入或更新；允许越过 scope_path，但不能跨 hostname 或命中 exclude_path。只抓给出的页面，不发现 Sitemap，也不跟随页面链接。404/410 会移除旧正文并保留 missing 目标。默认后台执行。',
      inputSchema: z
        .object({
          library_id: z.string().min(1),
          urls: z.array(z.url()).min(1).max(50),
          wait_for_completion: z.boolean().default(false)
        })
        .strict(),
      outputSchema: fetchPagesOutputSchema,
      annotations
    },
    async ({ library_id, urls, wait_for_completion }, context) => {
      const source = services.listSources().find((item) => item.id === library_id)
      if (!source) return failure('文档库不存在')
      if (source.cloud) return failure('云文档副本不能抓取指定页面')
      if (source.kind !== 'web') return failure('GitHub 文档库不支持指定页面抓取')
      if (!wait_for_completion) {
        startPageFetch(services, library_id, urls, context)
        return result(
          { library_id, sync_status: 'syncing', items: [] },
          '指定页面已登记并开始抓取；请用 library_id 查询同步状态'
        )
      }
      try {
        const output = await services.fetchPages(library_id, urls)
        return result(
          {
            library_id,
            sync_status: output.progress.failed ? 'completed_with_errors' : 'completed',
            run_id: output.runId,
            items: output.items,
            progress: serializeProgress(output.progress)
          },
          summarize(output.items)
        )
      } catch (error) {
        return result(
          {
            library_id,
            sync_status: 'failed',
            items: [],
            error: error instanceof Error ? error.message : '指定页面抓取失败'
          },
          '指定页面抓取失败'
        )
      }
    }
  )
}

function startPageFetch(
  services: LociMcpServices,
  libraryId: string,
  urls: readonly string[],
  context: LociToolContext
): void {
  const task = services
    .fetchPages(libraryId, urls)
    .then(() => undefined)
    .catch(() => undefined)
  context.trackBackgroundTask?.(task)
}

function summarize(items: readonly { status: string }[]): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1)
  return [...counts].map(([status, count]) => `${status}: ${count}`).join('，')
}
