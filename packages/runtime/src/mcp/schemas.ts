import * as z from 'zod/v4'

export const paginationInput = {
  offset: z.number().int().min(0).default(0).describe('跳过的结果数量，默认 0'),
  limit: z.number().int().min(1).max(100).default(20).describe('本次最多返回 100 项')
}

export const librarySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  mode: z.enum(['auto', 'http', 'browser']),
  availability: z.enum(['usable', 'empty']),
  pages: z.number().int(),
  content_size: z.number().int().nonnegative(),
  page_limit: z.number().int(),
  scope_path: z.string(),
  last_updated: z.string(),
  schedule: z.string().nullable(),
  http_concurrency: z.number().int().nullable(),
  browser_concurrency: z.number().int().nullable(),
  kind: z.enum(['web', 'github']),
  github_archive_limit_mb: z.number().int().nullable(),
  github_markdown_limit_mb: z.number().int().nullable(),
  icon_url: z.string().nullable()
})

export const failureSchema = z.object({
  url: z.string(),
  reason: z.enum([
    'not_found',
    'out_of_scope_redirect',
    'http_error',
    'request_error',
    'git_lfs_unsupported'
  ]),
  message: z.string(),
  retryable: z.boolean(),
  status_code: z.number().int().optional(),
  redirect_url: z.string().optional()
})

export const progressSchema = z.object({
  queued: z.number().int(),
  processed: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  limit_reached: z.boolean(),
  failures_total: z.number().int().nonnegative(),
  failure_counts: z.record(z.string(), z.number().int().nonnegative()),
  failures_sample: z.array(failureSchema).optional(),
  has_more_failures: z.boolean()
})

const syncStatusSchema = z.enum([
  'idle',
  'syncing',
  'completed',
  'completed_with_errors',
  'failed',
  'not_found'
])

export const addLibraryOutputSchema = z.object({
  created: z.boolean(),
  sync_status: syncStatusSchema,
  library: librarySchema,
  run_id: z.string().optional(),
  file_count: z.number().int().optional(),
  progress: progressSchema.optional(),
  error: z.string().optional()
})

const syncItemSchema = z.object({
  library_id: z.string(),
  sync_status: syncStatusSchema,
  run_id: z.string().optional(),
  file_count: z.number().int().optional(),
  progress: progressSchema.optional(),
  error: z.string().optional()
})

export const syncLibrariesOutputSchema = z.object({ items: z.array(syncItemSchema) })
export const syncStatusOutputSchema = z.object({ items: z.array(syncItemSchema) })

export const syncFailuresOutputSchema = z.object({
  library_id: z.string(),
  run_id: z.string(),
  total_count: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  items: z.array(failureSchema),
  has_more: z.boolean(),
  next_offset: z.number().int().optional()
})

export const listLibrariesOutputSchema = z.object({
  total_count: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  items: z.array(librarySchema),
  has_more: z.boolean(),
  next_offset: z.number().int().optional()
})

const cloudLibrarySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  revision: z.string(),
  pages: z.number().int(),
  content_size: z.number().int().nonnegative(),
  last_crawled_at: z.string().nullable(),
  published_at: z.string(),
  local_source_id: z.string().nullable(),
  local_revision: z.string().nullable(),
  auto_sync: z.boolean(),
  update_available: z.boolean()
})

export const listCloudLibrariesOutputSchema = z.object({
  total_count: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  items: z.array(cloudLibrarySchema),
  has_more: z.boolean(),
  next_offset: z.number().int().optional()
})

export const pullCloudLibraryOutputSchema = z.object({
  updated: z.boolean(),
  documents: z.number().int(),
  library: librarySchema
})

export interface TreeNodeOutput {
  id: string
  title: string
  readable: boolean
  language?: string
  children?: TreeNodeOutput[]
}

const treeNodeSchema: z.ZodType<TreeNodeOutput> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    readable: z.boolean(),
    language: z.string().optional(),
    children: z.array(treeNodeSchema).optional()
  })
)

export const treeOutputSchema = z.object({
  library_id: z.string(),
  title: z.string(),
  languages: z.array(z.string()),
  parent_id: z.string().optional(),
  depth: z.number().int(),
  nodes: z.array(treeNodeSchema)
})

const readFileSchema = z.object({
  id: z.string(),
  library_id: z.string(),
  title: z.string(),
  section_id: z.string().optional(),
  section_title: z.string().optional(),
  path: z.string(),
  source_url: z.string(),
  language: z.string(),
  updated_at: z.string(),
  content: z.string(),
  offset: z.number().int(),
  next_offset: z.number().int().optional(),
  total_chars: z.number().int(),
  truncated: z.boolean()
})

export const readFilesOutputSchema = z.object({
  files: z.array(readFileSchema),
  not_found: z.array(z.string())
})

const searchHitSchema = z.object({
  file_id: z.string(),
  library_id: z.string(),
  file_title: z.string(),
  section_id: z.string(),
  section_title: z.string(),
  path: z.string(),
  source_url: z.string(),
  paragraph: z.string(),
  truncated: z.boolean()
})

const searchResultSchema = z.object({
  query: z.string(),
  retrieval_mode: z.enum(['all_terms', 'any_terms', 'fuzzy']),
  fallback_used: z.boolean(),
  total_count: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  items: z.array(searchHitSchema),
  has_more: z.boolean(),
  next_offset: z.number().int().optional()
})

export const searchOutputSchema = z.object({
  results: z.array(searchResultSchema)
})

export const deleteLibraryOutputSchema = z.object({
  deleted: z.boolean(),
  library_id: z.string()
})
