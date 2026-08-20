import { z } from 'zod'
import { DOCUMENT_SOURCE_LIMITS, normalizeExcludePathPattern } from '@loci/core'
import { APP_SETTINGS_LIMITS, isValidBatchIntervalSeconds } from '@loci/shared'

const pageLimitSchema = z
  .number()
  .int()
  .min(DOCUMENT_SOURCE_LIMITS.pageLimit.min)
  .max(DOCUMENT_SOURCE_LIMITS.pageLimit.max)
const concurrencySchema = z
  .number()
  .int()
  .min(DOCUMENT_SOURCE_LIMITS.concurrency.min)
  .max(DOCUMENT_SOURCE_LIMITS.concurrency.max)
const githubSizeSchema = z
  .number()
  .int()
  .min(DOCUMENT_SOURCE_LIMITS.githubSizeMb.min)
  .max(DOCUMENT_SOURCE_LIMITS.githubSizeMb.max)
const excludePathPatternSchema = z
  .string()
  .max(DOCUMENT_SOURCE_LIMITS.excludePathPatternLength.max)
  .refine((value) => {
    try {
      normalizeExcludePathPattern(value)
      return true
    } catch {
      return false
    }
  }, '排除路径正则格式无效')

const sourceSchema = z
  .object({
    id: z.string().min(1),
    // 兼容统一名称上限生效前导出的旧数据。
    name: z.string().min(DOCUMENT_SOURCE_LIMITS.nameLength.min),
    first_url: z.string().url(),
    hostname: z.string().min(1),
    fetch_mode: z.enum(['auto', 'http', 'browser']),
    page_limit: pageLimitSchema,
    scope_path: z.string().startsWith('/').optional(),
    exclude_path_pattern: excludePathPatternSchema.nullable().optional(),
    schedule: z.string().nullable(),
    http_concurrency: concurrencySchema.nullable().optional(),
    browser_concurrency: concurrencySchema.nullable().optional(),
    concurrency: concurrencySchema.nullable().optional(),
    icon_url: z.string().nullable(),
    source_type: z.enum(['local', 'cloud']).optional(),
    cloud_server_url: z.string().nullable().optional(),
    cloud_library_id: z.string().nullable().optional(),
    cloud_revision: z.string().nullable().optional(),
    cloud_auto_sync: z.number().int().min(0).max(1).optional(),
    document_kind: z.enum(['web', 'github']).optional(),
    source_identity: z.string().nullable().optional(),
    github_archive_limit_mb: githubSizeSchema.nullable().optional(),
    github_markdown_limit_mb: githubSizeSchema.nullable().optional(),
    github_default_branch: z.string().nullable().optional(),
    github_revision: z.string().nullable().optional(),
    github_blocked_revision: z.string().nullable().optional(),
    github_blocked_limit_kind: z.enum(['archive', 'markdown']).nullable().optional(),
    github_blocked_limit_bytes: z.number().int().positive().nullable().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime()
  })
  .strict()

const documentSchema = z
  .object({
    id: z.string().min(1),
    source_id: z.string().min(1),
    title: z.string(),
    url: z.string().url(),
    crawled_at: z.string().datetime(),
    markdown: z.string(),
    language: z.string(),
    fetch_mode: z.enum(['http', 'browser']),
    relative_path: z.string().nullable().optional()
  })
  .strict()

const crawlRunSchema = z
  .object({
    id: z.string().min(1),
    source_id: z.string().min(1),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    started_at: z.string().datetime().nullable(),
    finished_at: z.string().datetime().nullable(),
    discovered_count: z.number().int().nonnegative(),
    success_count: z.number().int().nonnegative(),
    failure_count: z.number().int().nonnegative(),
    error_message: z.string().nullable()
  })
  .strict()

const crawlFailureSchema = z
  .object({
    id: z.string().min(1),
    run_id: z.string().min(1),
    url: z.string().url(),
    reason: z.enum([
      'not_found',
      'out_of_scope_redirect',
      'http_error',
      'request_error',
      'git_lfs_unsupported'
    ]),
    message: z.string(),
    retryable: z.number().int().min(0).max(1),
    status_code: z.number().int().nullable(),
    redirect_url: z.string().url().nullable()
  })
  .strict()

const settingsSchema = z
  .object({
    mcp_port: z
      .number()
      .int()
      .min(APP_SETTINGS_LIMITS.mcpPort.min)
      .max(APP_SETTINGS_LIMITS.mcpPort.max),
    theme: z.enum(['auto', 'light', 'dark']),
    http_concurrency: concurrencySchema,
    browser_concurrency: concurrencySchema,
    max_retries: z
      .number()
      .int()
      .min(APP_SETTINGS_LIMITS.maxRetries.min)
      .max(APP_SETTINGS_LIMITS.maxRetries.max)
      .optional(),
    batch_interval_seconds: z.number().int().refine(isValidBatchIntervalSeconds).optional(),
    server_url: z.string().url().optional(),
    github_archive_limit_mb: githubSizeSchema.optional(),
    github_markdown_limit_mb: githubSizeSchema.optional()
  })
  .strict()

export const lociBackupSchema = z
  .object({
    format: z.literal('loci-backup'),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    data: z
      .object({
        sources: z.array(sourceSchema),
        documents: z.array(documentSchema),
        crawlRuns: z.array(crawlRunSchema),
        crawlFailures: z.array(crawlFailureSchema).optional(),
        settings: settingsSchema
      })
      .strict()
  })
  .strict()
  .superRefine(({ data }, context) => {
    const sourceIds = new Set(data.sources.map((source) => source.id))
    validateUniqueIds(data.sources, ['data', 'sources'], context)
    validateUniqueIds(data.documents, ['data', 'documents'], context)
    validateUniqueIds(data.crawlRuns, ['data', 'crawlRuns'], context)
    validateUniqueIds(data.crawlFailures ?? [], ['data', 'crawlFailures'], context)
    const runIds = new Set(data.crawlRuns.map((run) => run.id))
    data.documents.forEach((document, index) => {
      if (!sourceIds.has(document.source_id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'documents', index, 'source_id'],
          message: '引用的文档源不存在'
        })
      }
    })
    data.crawlRuns.forEach((run, index) => {
      if (!sourceIds.has(run.source_id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'crawlRuns', index, 'source_id'],
          message: '引用的文档源不存在'
        })
      }
    })
    ;(data.crawlFailures ?? []).forEach((failure, index) => {
      if (!runIds.has(failure.run_id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'crawlFailures', index, 'run_id'],
          message: '引用的抓取记录不存在'
        })
      }
    })
  })

export type LociBackup = z.infer<typeof lociBackupSchema>

export function parseLociBackup(input: unknown): LociBackup {
  const result = lociBackupSchema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = issue?.path.join('.') || '根节点'
  throw new Error(`备份文件格式无效：${path} ${issue?.message ?? '未知错误'}`)
}

function validateUniqueIds(
  rows: Array<{ id: string }>,
  path: Array<string | number>,
  context: z.RefinementCtx
): void {
  const ids = new Set<string>()
  rows.forEach((row, index) => {
    if (ids.has(row.id)) {
      context.addIssue({ code: 'custom', path: [...path, index, 'id'], message: 'ID 重复' })
    }
    ids.add(row.id)
  })
}
