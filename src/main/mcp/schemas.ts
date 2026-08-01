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
  status: z.enum(['healthy', 'syncing', 'attention']),
  pages: z.number().int(),
  page_limit: z.number().int(),
  last_updated: z.string(),
  schedule: z.string().nullable(),
  concurrency: z.number().int().nullable(),
  icon_url: z.string().nullable()
})

const failureSchema = z.object({
  url: z.string(),
  reason: z.enum(['not_found', 'out_of_scope_redirect', 'http_error', 'request_error']),
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
  failures: z.array(failureSchema).optional()
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
  status: syncStatusSchema,
  library: librarySchema,
  file_count: z.number().int().optional(),
  progress: progressSchema.optional(),
  error: z.string().optional()
})

const syncItemSchema = z.object({
  library_id: z.string(),
  status: syncStatusSchema,
  file_count: z.number().int().optional(),
  progress: progressSchema.optional(),
  error: z.string().optional()
})

export const syncLibrariesOutputSchema = z.object({ items: z.array(syncItemSchema) })
export const syncStatusOutputSchema = z.object({ items: z.array(syncItemSchema) })

export const listLibrariesOutputSchema = z.object({
  total_count: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  items: z.array(librarySchema),
  has_more: z.boolean(),
  next_offset: z.number().int().optional()
})

export interface TreeNodeOutput {
  id: string
  title: string
  readable: boolean
  children?: TreeNodeOutput[]
}

const treeNodeSchema: z.ZodType<TreeNodeOutput> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    readable: z.boolean(),
    children: z.array(treeNodeSchema).optional()
  })
)

export const treeOutputSchema = z.object({
  library_id: z.string(),
  title: z.string(),
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

export const searchOutputSchema = z.object({
  total_count: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  items: z.array(searchHitSchema),
  has_more: z.boolean(),
  next_offset: z.number().int().optional()
})

export const deleteLibraryOutputSchema = z.object({
  deleted: z.boolean(),
  library_id: z.string()
})
