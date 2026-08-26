import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS, normalizeScopePath } from '@loci/core'
import * as z from 'zod/v4'
import { inspectSourceOutputSchema, updateLibraryOutputSchema } from './schemas.js'
import type { LociMcpServices } from './services.js'
import { failure, remoteReadAnnotations, result, serializeLibrary } from './server-support.js'
import type { LociToolRegistrar } from './tool-registry.js'

const excludePathSchema = z
  .string()
  .trim()
  .max(DOCUMENT_SOURCE_LIMITS.excludePathPatternLength.max)
  .nullable()
  .optional()

export function registerSourcePlanningTools(
  register: LociToolRegistrar,
  services: LociMcpServices
): void {
  registerInspectSource(register, services)
  registerUpdateLibrary(register, services)
}

function registerInspectSource(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_inspect_library_source',
    {
      title: '检查文档来源规模',
      description:
        '只读检查 llms.txt、Sitemap、OpenAPI 或 GitHub 元数据，返回规模可信度和路径分布；普通递归站点可能返回 unknown，不会为估算完整抓取。页面上限、范围和排除规则仍是可选决策。',
      inputSchema: z
        .object({
          url: z.url().describe('任意公开文档页面 URL'),
          scope_path: z.string().trim().startsWith('/').default(DOCUMENT_SOURCE_DEFAULTS.scopePath),
          exclude_path: excludePathSchema.describe('可选 pathname 排除正则，用于估算排除后的规模')
        })
        .strict(),
      outputSchema: inspectSourceOutputSchema,
      annotations: remoteReadAnnotations()
    },
    async (input, context) => {
      const inspection = await services.inspectSource({
        url: input.url,
        scopePath: input.scope_path,
        excludePathPattern: input.exclude_path,
        signal: context.signal
      })
      const output = {
        url: inspection.url,
        hostname: inspection.hostname,
        kind: inspection.kind,
        scope_path: inspection.scopePath,
        discovery: inspection.discovery,
        estimate_kind: inspection.estimateKind,
        estimated_pages: inspection.estimatedPages,
        discovered_pages: inspection.discoveredPages,
        excluded_pages: inspection.excludedPages,
        exceeds_hard_limit: inspection.exceedsHardLimit,
        hard_page_limit: inspection.hardPageLimit,
        path_groups: inspection.pathGroups,
        ...(inspection.githubDefaultBranch
          ? { github_default_branch: inspection.githubDefaultBranch }
          : {}),
        ...(inspection.githubRevision ? { github_revision: inspection.githubRevision } : {})
      }
      const summary =
        inspection.estimateKind === 'unknown'
          ? `无法通过轻量清单估算 ${inspection.hostname} 的页面数量`
          : `发现方式 ${inspection.discovery}，估算 ${String(inspection.estimatedPages)} 页`
      return result(output, summary)
    }
  )
}

function registerUpdateLibrary(register: LociToolRegistrar, services: LociMcpServices): void {
  const inputSchema = z
    .object({
      library_id: z.string().min(1),
      mode: z.enum(['auto', 'http', 'browser']).optional(),
      page_limit: z
        .number()
        .int()
        .min(DOCUMENT_SOURCE_LIMITS.pageLimit.min)
        .max(DOCUMENT_SOURCE_LIMITS.pageLimit.max)
        .optional(),
      scope_path: z.string().trim().startsWith('/').optional(),
      exclude_path: excludePathSchema.describe('传 null 清除排除规则'),
      http_concurrency: nullableConcurrency('传 null 恢复继承全局 HTTP 并发'),
      browser_concurrency: nullableConcurrency('传 null 恢复继承全局浏览器并发'),
      github_archive_limit_mb: nullableSize('传 null 恢复继承全局 GitHub ZIP 上限'),
      github_markdown_limit_mb: nullableSize('传 null 恢复继承全局 Markdown 上限')
    })
    .strict()
    .refine(
      (input) =>
        Object.entries(input).some(([key, value]) => key !== 'library_id' && value !== undefined),
      '至少提供一个需要修改的配置'
    )

  register(
    'loci_update_library',
    {
      title: '修改本地文档库抓取配置',
      description:
        '按 ID 修改已有本地文档库的可选抓取配置；收窄范围或新增排除规则会立即删除不再匹配的本地文件，但不会自动同步。',
      inputSchema,
      outputSchema: updateLibraryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    (input) => {
      const source = services.listSources().find((item) => item.id === input.library_id)
      if (!source) return failure('文档库不存在')
      if (source.cloud) return failure('云端副本不能修改抓取配置')
      if (services.isCrawling(source.id)) return failure('文档库正在同步，完成后才能修改配置')
      const updated = services.updateSource(source, {
        name: source.name,
        url: source.url,
        mode: input.mode ?? source.mode,
        pageLimit: input.page_limit ?? source.pageLimit,
        scopePath: normalizeScopePath(input.scope_path ?? source.scopePath),
        excludePathPattern:
          input.exclude_path === undefined
            ? (source.excludePathPattern ?? null)
            : input.exclude_path,
        httpConcurrency:
          input.http_concurrency === undefined ? source.httpConcurrency : input.http_concurrency,
        browserConcurrency:
          input.browser_concurrency === undefined
            ? source.browserConcurrency
            : input.browser_concurrency,
        githubArchiveLimitMb:
          input.github_archive_limit_mb === undefined
            ? source.githubArchiveLimitMb
            : input.github_archive_limit_mb,
        githubMarkdownLimitMb:
          input.github_markdown_limit_mb === undefined
            ? source.githubMarkdownLimitMb
            : input.github_markdown_limit_mb
      })
      return result(
        { changed: changed(source, updated), library: serializeLibrary(updated) },
        '文档库抓取配置已保存；需要时再调用同步工具'
      )
    }
  )
}

function nullableConcurrency(description: string): z.ZodOptional<z.ZodNullable<z.ZodNumber>> {
  return z
    .number()
    .int()
    .min(DOCUMENT_SOURCE_LIMITS.concurrency.min)
    .max(DOCUMENT_SOURCE_LIMITS.concurrency.max)
    .nullable()
    .optional()
    .describe(description)
}

function nullableSize(description: string): z.ZodOptional<z.ZodNullable<z.ZodNumber>> {
  return z
    .number()
    .int()
    .min(DOCUMENT_SOURCE_LIMITS.githubSizeMb.min)
    .max(DOCUMENT_SOURCE_LIMITS.githubSizeMb.max)
    .nullable()
    .optional()
    .describe(description)
}

function changed(before: object, after: object): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}
