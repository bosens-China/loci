import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS, normalizeScopePath } from '@loci/core'
import { deriveSourceName } from '@loci/shared'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import {
  addLibraryOutputSchema,
  paginationInput,
  syncFailuresOutputSchema,
  syncLibrariesOutputSchema,
  syncStatusOutputSchema
} from './schemas.js'
import type { LociMcpServices } from './services.js'
import {
  failure,
  page,
  readAnnotations,
  result,
  serializeFailure,
  serializeLibrary,
  startInBackground,
  stateToSyncItem,
  syncSummary,
  waitForSync,
  writeAnnotations
} from './server-support.js'

const WAIT_DESCRIPTION =
  '默认立即返回 syncing；需要在单次调用内等待结果时传 wait_for_completion=true，并设置客户端进度回调。'

export function registerSyncTools(server: McpServer, services: LociMcpServices): void {
  registerAddLibrary(server, services)
  registerSyncLibraries(server, services)
  registerSyncStatus(server, services)
  registerSyncFailures(server, services)
}

function registerAddLibrary(server: McpServer, services: LociMcpServices): void {
  server.registerTool(
    'loci_add_library',
    {
      title: '添加网页文档库',
      description: `按产品基础值创建本地文档库；可覆盖抓取方式、页面上限、路径范围、并发和 GitHub 大小上限。相同 hostname 与路径范围会复用。${WAIT_DESCRIPTION}`,
      inputSchema: z
        .object({
          url: z.url().describe('任意公开文档页面 URL'),
          name: z
            .string()
            .trim()
            .min(DOCUMENT_SOURCE_LIMITS.nameLength.min)
            .max(DOCUMENT_SOURCE_LIMITS.nameLength.max)
            .optional()
            .describe('默认根据 URL 生成'),
          mode: z.enum(['auto', 'http', 'browser']).default(DOCUMENT_SOURCE_DEFAULTS.mode),
          page_limit: z
            .number()
            .int()
            .min(DOCUMENT_SOURCE_LIMITS.pageLimit.min)
            .max(DOCUMENT_SOURCE_LIMITS.pageLimit.max)
            .default(DOCUMENT_SOURCE_DEFAULTS.pageLimit),
          scope_path: z.string().trim().startsWith('/').default(DOCUMENT_SOURCE_DEFAULTS.scopePath),
          http_concurrency: concurrencySchema('省略时使用全局 HTTP 默认值'),
          browser_concurrency: concurrencySchema('省略时使用全局浏览器默认值'),
          github_archive_limit_mb: sizeSchema('省略时使用全局 GitHub ZIP 默认值'),
          github_markdown_limit_mb: sizeSchema('省略时使用全局 GitHub Markdown 默认值'),
          wait_for_completion: z.boolean().default(false)
        })
        .strict(),
      outputSchema: addLibraryOutputSchema,
      annotations: writeAnnotations(true)
    },
    async (input, context) => {
      const before = new Set(services.listSources().map((item) => item.id))
      const source = services.createSource({
        name: input.name ?? (deriveSourceName(input.url) || new URL(input.url).hostname),
        url: input.url,
        mode: input.mode,
        pageLimit: input.page_limit,
        scopePath: normalizeScopePath(input.scope_path),
        schedule: DOCUMENT_SOURCE_DEFAULTS.schedule,
        httpConcurrency: input.http_concurrency ?? DOCUMENT_SOURCE_DEFAULTS.httpConcurrency,
        browserConcurrency:
          input.browser_concurrency ?? DOCUMENT_SOURCE_DEFAULTS.browserConcurrency,
        githubArchiveLimitMb:
          input.github_archive_limit_mb ?? DOCUMENT_SOURCE_DEFAULTS.githubArchiveLimitMb,
        githubMarkdownLimitMb:
          input.github_markdown_limit_mb ?? DOCUMENT_SOURCE_DEFAULTS.githubMarkdownLimitMb
      })
      const created = !before.has(source.id)
      if (!created && !services.isCrawling(source.id) && source.pages > 0) {
        return result(
          { created: false, sync_status: 'idle', library: serializeLibrary(source) },
          '文档库已存在'
        )
      }
      if (!input.wait_for_completion) {
        startInBackground(services, source.id)
        return result(
          {
            created,
            sync_status: 'syncing',
            library: serializeLibrary(source)
          },
          created
            ? '文档库已创建并开始同步；请用 library_id 查询进度'
            : '文档库正在同步；请用 library_id 查询进度'
        )
      }
      const item = await waitForSync(services, source.id, context)
      const sync = { ...item }
      delete sync.library_id
      const current = services.listSources().find((entry) => entry.id === source.id) ?? source
      return result(
        { created, ...sync, library: serializeLibrary(current) },
        `文档库同步状态：${String(item.sync_status)}`
      )
    }
  )
}

function registerSyncLibraries(server: McpServer, services: LociMcpServices): void {
  server.registerTool(
    'loci_sync_libraries',
    {
      title: '同步网页文档库',
      description: `按文档库 ID 重新拉取网页内容；新增页面会写入，404/410 页面会移除。${WAIT_DESCRIPTION}`,
      inputSchema: z
        .object({
          library_ids: z.array(z.string().min(1)).min(1).max(10),
          wait_for_completion: z.boolean().default(false)
        })
        .strict(),
      outputSchema: syncLibrariesOutputSchema,
      annotations: writeAnnotations(false)
    },
    async ({ library_ids, wait_for_completion }, context) => {
      const available = new Set(services.listSources().map((source) => source.id))
      const items: Array<Record<string, unknown>> = []
      for (const id of new Set(library_ids)) {
        if (!available.has(id)) {
          items.push({ library_id: id, sync_status: 'not_found' })
        } else if (services.isCrawling(id)) {
          const state = services.getCrawlState(id)
          items.push(
            wait_for_completion
              ? await waitForSync(services, id, context)
              : stateToSyncItem(id, state, true, services.getLatestCrawlRunId(id))
          )
        } else if (wait_for_completion) {
          items.push(await waitForSync(services, id, context))
        } else {
          startInBackground(services, id)
          items.push({ library_id: id, sync_status: 'syncing' })
        }
      }
      return result({ items }, items.map(syncSummary).join('\n'))
    }
  )
}

function registerSyncStatus(server: McpServer, services: LociMcpServices): void {
  server.registerTool(
    'loci_get_sync_status',
    {
      title: '查看文档库同步状态',
      description: '按文档库 ID 查询实时进度和有限失败摘要；完整失败使用 run_id 分页读取。',
      inputSchema: z.object({ library_ids: z.array(z.string().min(1)).min(1).max(20) }).strict(),
      outputSchema: syncStatusOutputSchema,
      annotations: readAnnotations()
    },
    ({ library_ids }) => {
      const available = new Set(services.listSources().map((source) => source.id))
      const items = [...new Set(library_ids)].map((id) =>
        available.has(id)
          ? stateToSyncItem(
              id,
              services.getCrawlState(id),
              services.isCrawling(id),
              services.getLatestCrawlRunId(id)
            )
          : { library_id: id, sync_status: 'not_found' }
      )
      return result({ items }, items.map(syncSummary).join('\n'))
    }
  )
}

function registerSyncFailures(server: McpServer, services: LociMcpServices): void {
  server.registerTool(
    'loci_list_sync_failures',
    {
      title: '分页查看同步失败',
      description: '使用同步结果中的 run_id 分页读取完整失败 URL、原因和重试信息。',
      inputSchema: z.object({ run_id: z.string().min(1), ...paginationInput }).strict(),
      outputSchema: syncFailuresOutputSchema,
      annotations: readAnnotations()
    },
    ({ run_id, offset, limit }) => {
      const libraryId = services.getCrawlRunLibraryId(run_id)
      if (!libraryId) return failure('同步运行不存在，请先按 library_id 查询同步状态')
      const failures = services.listCrawlFailures(run_id)
      const output = page(
        failures.slice(offset, offset + limit).map(serializeFailure),
        failures.length,
        offset,
        limit
      )
      return result(
        { library_id: libraryId, run_id, ...output },
        `返回 ${String(output.count)} 条失败，共 ${failures.length} 条`
      )
    }
  )
}

function concurrencySchema(description: string): z.ZodOptional<z.ZodNumber> {
  return z
    .number()
    .int()
    .min(DOCUMENT_SOURCE_LIMITS.concurrency.min)
    .max(DOCUMENT_SOURCE_LIMITS.concurrency.max)
    .optional()
    .describe(description)
}

function sizeSchema(description: string): z.ZodOptional<z.ZodNumber> {
  return z
    .number()
    .int()
    .min(DOCUMENT_SOURCE_LIMITS.githubSizeMb.min)
    .max(DOCUMENT_SOURCE_LIMITS.githubSizeMb.max)
    .optional()
    .describe(description)
}
