import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS, normalizeScopePath } from '@loci/core'
import { deriveSourceName } from '@loci/shared'
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
  createProgressReporter,
  failure,
  page,
  readAnnotations,
  result,
  serializeFailure,
  serializeLibrary,
  serializeProgress,
  startInBackground,
  stateToSyncItem,
  syncSummary,
  waitForSync,
  writeAnnotations
} from './server-support.js'
import type { LociToolRegistrar } from './tool-registry.js'
import { serializeUrlReview } from './url-review-tools.js'
import { rethrowRequestCancellation } from '../url-review-cancellation.js'

const WAIT_DESCRIPTION =
  '默认立即返回 syncing；需要逐页等待时传 wait_for_completion=true，工具会使用 MCP SDK 原生 Progress，并响应当前请求的 Cancellation。'

export function registerSyncTools(register: LociToolRegistrar, services: LociMcpServices): void {
  registerAddLibrary(register, services)
  registerSyncLibraries(register, services)
  registerSyncStatus(register, services)
  registerSyncFailures(register, services)
}

function registerAddLibrary(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_add_library',
    {
      title: '添加网页文档库',
      description: `按产品基础值创建本地文档库；discovery_mode=selected 只抓指定页面；agent_review 会把每批 title + url 交给 Agent 思考，并只接收排除清单。相同 hostname 与路径范围会复用。${WAIT_DESCRIPTION}`,
      inputSchema: z
        .object({
          url: z.url().describe('任意公开文档页面 URL'),
          urls: z
            .array(z.url())
            .max(49)
            .optional()
            .describe('selected 模式下的其余指定页面；加上 url 最多 50 个'),
          discovery_mode: z
            .enum(['site', 'selected', 'agent_review'])
            .default('site')
            .describe('site 默认发现；selected 只抓指定页面；agent_review 逐批由 Agent 排除'),
          review_goal: z
            .string()
            .trim()
            .min(1)
            .max(2_000)
            .optional()
            .describe('agent_review 必填，例如“只收录 API 与组件文档”'),
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
          exclude_path: z
            .string()
            .trim()
            .max(DOCUMENT_SOURCE_LIMITS.excludePathPatternLength.max)
            .nullable()
            .optional()
            .describe('可选 pathname 排除正则；省略时不排除'),
          http_concurrency: concurrencySchema('省略时使用全局 HTTP 默认值'),
          browser_concurrency: concurrencySchema('省略时使用全局浏览器默认值'),
          github_archive_limit_mb: sizeSchema('省略时使用全局 GitHub ZIP 默认值'),
          github_markdown_limit_mb: sizeSchema('省略时使用全局 GitHub Markdown 默认值'),
          wait_for_completion: z.boolean().default(false)
        })
        .strict()
        .superRefine((input, context) => {
          if (input.discovery_mode === 'agent_review' && !input.review_goal) {
            context.addIssue({
              code: 'custom',
              path: ['review_goal'],
              message: 'agent_review 模式必须提供 review_goal'
            })
          }
          if (input.discovery_mode !== 'selected' && input.urls?.length) {
            context.addIssue({
              code: 'custom',
              path: ['urls'],
              message: 'urls 只用于 selected 模式'
            })
          }
        }),
      outputSchema: addLibraryOutputSchema,
      annotations: { ...writeAnnotations(true), destructiveHint: true }
    },
    async (input, context) => {
      const before = new Set(services.listSources().map((item) => item.id))
      const source = services.createSource({
        name: input.name ?? (deriveSourceName(input.url) || new URL(input.url).hostname),
        url: input.url,
        mode: input.mode,
        pageLimit: input.page_limit,
        scopePath: normalizeScopePath(input.scope_path),
        excludePathPattern: input.exclude_path ?? DOCUMENT_SOURCE_DEFAULTS.excludePathPattern,
        schedule: DOCUMENT_SOURCE_DEFAULTS.schedule,
        httpConcurrency: input.http_concurrency ?? DOCUMENT_SOURCE_DEFAULTS.httpConcurrency,
        browserConcurrency:
          input.browser_concurrency ?? DOCUMENT_SOURCE_DEFAULTS.browserConcurrency,
        githubArchiveLimitMb:
          input.github_archive_limit_mb ?? DOCUMENT_SOURCE_DEFAULTS.githubArchiveLimitMb,
        githubMarkdownLimitMb:
          input.github_markdown_limit_mb ?? DOCUMENT_SOURCE_DEFAULTS.githubMarkdownLimitMb,
        discoveryMode: input.discovery_mode === 'agent_review' ? 'agent_review' : 'site',
        reviewGoal: input.review_goal ?? null
      })
      const created = !before.has(source.id)
      const requestedMode = input.discovery_mode === 'agent_review' ? 'agent_review' : 'site'
      if (source.discoveryMode !== requestedMode) {
        return result(
          {
            created: false,
            sync_status: 'failed',
            error: `相同域名与路径范围的文档库已使用 ${source.discoveryMode} 模式`,
            library: serializeLibrary(source)
          },
          '文档库发现模式冲突'
        )
      }
      if (input.discovery_mode === 'agent_review') {
        try {
          const review = await services.startUrlReview(source.id, input.review_goal, context.signal)
          const current = services.listSources().find((entry) => entry.id === source.id) ?? source
          return result(
            {
              created,
              sync_status:
                review.run.status === 'awaiting_review'
                  ? 'awaiting_review'
                  : review.run.status === 'completed'
                    ? 'completed'
                    : review.run.status === 'failed' || review.run.status === 'cancelled'
                      ? 'failed'
                      : 'syncing',
              library: serializeLibrary(current),
              url_review: serializeUrlReview(review)
            },
            review.run.status === 'awaiting_review'
              ? '文档库已创建，等待 Agent 审查首批 URL'
              : `URL 审查状态：${review.run.status}`
          )
        } catch (error) {
          rethrowRequestCancellation(error, context.signal)
          return result(
            {
              created,
              sync_status: 'failed',
              error: error instanceof Error ? error.message : 'URL 审查启动失败',
              library: serializeLibrary(source)
            },
            'URL 审查启动失败'
          )
        }
      }
      if (input.discovery_mode === 'selected') {
        const urls = [...new Set([input.url, ...(input.urls ?? [])])]
        if (!input.wait_for_completion) {
          const task = services
            .fetchPages(source.id, urls)
            .then(() => undefined)
            .catch(() => undefined)
          context.trackBackgroundTask?.(task)
          return result(
            { created, sync_status: 'syncing', library: serializeLibrary(source) },
            created ? '文档库已创建并开始抓取指定页面' : '指定页面已加入现有文档库并开始更新'
          )
        }
        const reporter = createProgressReporter(context, source.id)
        try {
          const output = await services.fetchPages(source.id, urls, reporter.report, context.signal)
          await reporter.flush()
          const current = services.listSources().find((entry) => entry.id === source.id) ?? source
          return result(
            {
              created,
              sync_status: output.progress.failed ? 'completed_with_errors' : 'completed',
              run_id: output.runId,
              progress: serializeProgress(output.progress),
              page_items: output.items,
              library: serializeLibrary(current)
            },
            `指定页面处理完成：${output.items.length} 个`
          )
        } catch (error) {
          await reporter.flush()
          rethrowRequestCancellation(error, context.signal)
          return result(
            {
              created,
              sync_status: 'failed',
              error: error instanceof Error ? error.message : '指定页面抓取失败',
              library: serializeLibrary(source)
            },
            '指定页面抓取失败'
          )
        }
      }
      if (!created && !services.isCrawling(source.id) && source.pages > 0) {
        return result(
          { created: false, sync_status: 'idle', library: serializeLibrary(source) },
          '文档库已存在'
        )
      }
      if (!input.wait_for_completion) {
        startInBackground(services, source.id, context)
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

function registerSyncLibraries(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
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
        const review = services.getActiveUrlReview(id)
        if (!available.has(id)) {
          items.push({ library_id: id, sync_status: 'not_found' })
        } else if (review) {
          items.push({
            library_id: id,
            sync_status: 'awaiting_review',
            run_id: review.run.id
          })
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
          startInBackground(services, id, context)
          items.push({ library_id: id, sync_status: 'syncing' })
        }
      }
      return result({ items }, items.map(syncSummary).join('\n'))
    }
  )
}

function registerSyncStatus(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
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
      const items = [...new Set(library_ids)].map((id) => {
        if (!available.has(id)) return { library_id: id, sync_status: 'not_found' }
        const review = services.getActiveUrlReview(id)
        if (review) {
          return {
            library_id: id,
            sync_status: 'awaiting_review',
            run_id: review.run.id
          }
        }
        return stateToSyncItem(
          id,
          services.getCrawlState(id),
          services.isCrawling(id),
          services.getLatestCrawlRunId(id)
        )
      })
      return result({ items }, items.map(syncSummary).join('\n'))
    }
  )
}

function registerSyncFailures(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
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
