import type { CloudLibrary, CloudLibraryInput } from '@loci/shared'
import * as z from 'zod/v4'
import { page, readAnnotations, result } from './server-support.js'
import type { LociMcpServices } from './services.js'
import type { LociToolRegistrar } from './tool-registry.js'

const libraryInputSchema = z.object({
  name: z.string().trim().min(1),
  url: z.url(),
  scope_path: z.string().startsWith('/').default('/'),
  page_limit: z.number().int().min(1).max(10_000).default(1_000),
  schedule: z.string().trim().nullable().default(null)
})
const librarySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  hostname: z.string(),
  scope_path: z.string(),
  page_limit: z.number().int(),
  schedule: z.string().nullable(),
  pages: z.number().int().nonnegative(),
  last_crawled_at: z.string().nullable(),
  last_error: z.string().nullable(),
  revision: z.string().nullable(),
  published_at: z.string().nullable()
})

/** 管理端文档库工具显式使用 server 前缀，避免与本地库写操作混淆。 */
export function registerServerLibraryTools(
  register: LociToolRegistrar,
  services: LociMcpServices
): void {
  register(
    'loci_list_server_libraries',
    {
      title: '列出 Server 文档库',
      description: '列出管理员可见的全部 Server 文档库，包括尚未首次发布的库。',
      inputSchema: z.object({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20)
      }),
      outputSchema: z.object({
        total_count: z.number().int(),
        count: z.number().int(),
        offset: z.number().int(),
        items: z.array(librarySchema),
        has_more: z.boolean(),
        next_offset: z.number().int().optional()
      }),
      annotations: { ...readAnnotations(), openWorldHint: true }
    },
    async ({ offset, limit }) => {
      const libraries = await services.listServerLibraries()
      const items = libraries.slice(offset, offset + limit).map(serializeLibrary)
      return result(
        page(items, libraries.length, offset, limit),
        `找到 ${libraries.length} 个 Server 文档库`
      )
    }
  )

  register(
    'loci_create_server_library',
    {
      title: '创建 Server 文档库',
      description: '只创建 Server 文档库配置；需要另行调用同步工具抓取和发布内容。',
      inputSchema: libraryInputSchema,
      outputSchema: z.object({ library: librarySchema }),
      annotations: mutationAnnotations(false)
    },
    async (input) => {
      const library = await services.createServerLibrary(toInput(input))
      return result({ library: serializeLibrary(library) }, `已创建 Server 文档库 ${library.name}`)
    }
  )

  register(
    'loci_update_server_library',
    {
      title: '修改 Server 文档库',
      description: '用完整显式字段修改 Server 文档库配置，收窄范围可能移除不再匹配的内容。',
      inputSchema: libraryInputSchema.extend({ library_id: z.string().min(1) }),
      outputSchema: z.object({ library: librarySchema }),
      annotations: mutationAnnotations(true)
    },
    async ({ library_id, ...input }) => {
      const library = await services.updateServerLibrary(library_id, toInput(input))
      return result({ library: serializeLibrary(library) }, `已更新 Server 文档库 ${library.name}`)
    }
  )

  register(
    'loci_delete_server_library',
    {
      title: '删除 Server 文档库',
      description: '永久删除 Server 文档库、文档和公开快照。',
      inputSchema: z.object({ library_id: z.string().min(1) }),
      outputSchema: z.object({ deleted: z.boolean() }),
      annotations: mutationAnnotations(true)
    },
    async ({ library_id }) => {
      await services.deleteServerLibrary(library_id)
      return result({ deleted: true }, `已删除 Server 文档库 ${library_id}`)
    }
  )

  register(
    'loci_sync_server_libraries',
    {
      title: '同步 Server 文档库',
      description: '为一个或多个 Server 文档库提交持久同步任务；重复请求复用活动任务。',
      inputSchema: z.object({ library_ids: z.array(z.string().min(1)).min(1).max(100) }),
      outputSchema: z.object({ task_ids: z.array(z.string()), count: z.number().int() }),
      annotations: mutationAnnotations(false)
    },
    async ({ library_ids }) => {
      const tasks = await services.syncServerLibraries(library_ids)
      return result(
        { task_ids: tasks.map((task) => task.id), count: tasks.length },
        `已提交 ${tasks.length} 个 Server 同步任务`
      )
    }
  )
}

function toInput(input: z.output<typeof libraryInputSchema>): CloudLibraryInput {
  return {
    name: input.name,
    url: input.url,
    scopePath: input.scope_path,
    pageLimit: input.page_limit,
    schedule: input.schedule
  }
}

function serializeLibrary(library: CloudLibrary): z.output<typeof librarySchema> {
  return {
    id: library.id,
    name: library.name,
    url: library.url,
    hostname: library.hostname,
    scope_path: library.scopePath,
    page_limit: library.pageLimit,
    schedule: library.schedule,
    pages: library.pages,
    last_crawled_at: library.lastCrawledAt,
    last_error: library.lastError,
    revision: library.revision,
    published_at: library.publishedAt
  }
}

function mutationAnnotations(destructive: boolean) {
  return {
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: true,
    openWorldHint: true
  }
}
