import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { buildUrlTree } from '../../shared/url-tree'
import type {
  CreateSourceInput,
  CrawlProgress,
  DocumentRecord,
  DocumentSource
} from '../../shared/api'
import { findBestPassage } from './content'

export interface DocHubMcpServices {
  listSources: () => DocumentSource[]
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string) => DocumentRecord[]
  createSource: (input: CreateSourceInput) => DocumentSource
  crawlSource: (id: string) => Promise<CrawlProgress>
  deleteSource: (id: string) => void
  isCrawling: (id: string) => boolean
}

const paginationSchema = {
  offset: z.number().int().min(0).default(0).describe('跳过的结果数量，默认 0'),
  limit: z.number().int().min(1).max(100).default(20).describe('本次最多返回 100 项')
}

interface TreeNodeOutput {
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

// 所有工具都只编排现有本地服务，MCP 层不维护第二份文档或抓取状态。
export function createDocHubMcpServer(services: DocHubMcpServices): McpServer {
  const server = new McpServer({ name: 'doc-hub-mcp-server', version: '1.0.0' })

  server.registerTool(
    'doc_hub_add_document',
    {
      title: '添加网页文档',
      description:
        '从公开网页创建一个本地文档库并立即抓取同 hostname 页面。相同 hostname 已存在时返回已有文档；需要刷新已有文档时改用 doc_hub_sync_documents。',
      inputSchema: z.object({
        url: z.url().describe('任意公开文档页面 URL'),
        name: z.string().trim().min(1).max(100).optional().describe('文档名称，默认使用 hostname'),
        concurrency: z
          .number()
          .int()
          .min(1)
          .max(32)
          .optional()
          .describe('可选抓取并发；省略时按抓取模式使用全局默认值')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ url, name, concurrency }) => {
      const hostname = new URL(url).hostname
      const existing = services
        .listSources()
        .find((source) => new URL(source.url).hostname === hostname)
      if (existing) {
        const syncing = services.isCrawling(existing.id)
        const document = { ...existing, status: syncing ? 'syncing' : existing.status }
        return result(
          { created: false, document },
          syncing ? `文档正在同步：${existing.name}` : `文档已存在：${existing.name}`
        )
      }

      const source = services.createSource({
        name: name ?? hostname,
        url,
        mode: 'auto',
        pageLimit: 1000,
        schedule: null,
        concurrency: concurrency ?? null
      })
      try {
        const progress = await services.crawlSource(source.id)
        const document = services.listSources().find((item) => item.id === source.id) ?? source
        const fileCount = services
          .listDocuments()
          .filter((item) => item.sourceId === source.id).length
        const status = progress.failed > 0 ? 'completed_with_errors' : 'completed'
        return result(
          {
            created: true,
            status,
            document,
            file_count: fileCount,
            progress,
            ...(progress.failed > 0 ? { warning: `${progress.failed} 个页面抓取失败` } : {})
          },
          `已添加并收录 ${fileCount} 个唯一文件（成功 ${progress.succeeded} 页，失败 ${progress.failed} 页）`
        )
      } catch (error) {
        return failure(`文档已创建（${source.id}），首次抓取失败：${errorMessage(error)}`)
      }
    }
  )

  server.registerTool(
    'doc_hub_sync_documents',
    {
      title: '更新网页文档',
      description: '按文档 ID 重新拉取网页内容。可一次更新多个文档，并分别返回成功或失败状态。',
      inputSchema: z.object({
        document_ids: z.array(z.string().min(1)).min(1).max(10).describe('最多 10 个文档 ID')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ document_ids }) => {
      const available = new Set(services.listSources().map((source) => source.id))
      const items: Array<Record<string, unknown>> = []
      for (const id of new Set(document_ids)) {
        if (!available.has(id)) {
          items.push({ document_id: id, status: 'not_found' })
          continue
        }
        if (services.isCrawling(id)) {
          items.push({ document_id: id, status: 'syncing' })
          continue
        }
        try {
          const progress = await services.crawlSource(id)
          const fileCount = services.listDocuments().filter((item) => item.sourceId === id).length
          items.push({
            document_id: id,
            status: progress.failed > 0 ? 'completed_with_errors' : 'completed',
            file_count: fileCount,
            progress,
            ...(progress.failed > 0 ? { warning: `${progress.failed} 个页面抓取失败` } : {})
          })
        } catch (error) {
          items.push({ document_id: id, status: 'failed', error: errorMessage(error) })
        }
      }
      return result(
        { items },
        items.map((item) => `${String(item.document_id)}: ${String(item.status)}`).join('\n')
      )
    }
  )

  server.registerTool(
    'doc_hub_list_documents',
    {
      title: '查看本地文档',
      description:
        '分页列出本地文档库。不知道文档 ID 时应首先调用；query 可省略，只匹配文档名称和来源 URL，不搜索正文。',
      inputSchema: z.object({
        query: z.string().trim().max(200).optional().describe('可选的文档名称或 URL 关键词'),
        ...paginationSchema
      }),
      annotations: readAnnotations()
    },
    ({ query, offset, limit }) => {
      const keyword = query?.toLocaleLowerCase()
      const matches = services
        .listSources()
        .filter(
          (source) =>
            !keyword ||
            source.name.toLocaleLowerCase().includes(keyword) ||
            source.url.toLocaleLowerCase().includes(keyword)
        )
      const items = matches.slice(offset, offset + limit).map((source) => ({
        ...source,
        status: services.isCrawling(source.id) ? 'syncing' : source.status
      }))
      return result(page(items, matches.length, offset, limit), `找到 ${matches.length} 个文档`)
    }
  )

  server.registerTool(
    'doc_hub_get_tree',
    {
      title: '查看文档目录',
      description:
        '返回一个文档库的 URL 层级目录。先查看目录，再选择 readable=true 的文件 ID 调用 doc_hub_read_files。',
      inputSchema: z.object({ document_id: z.string().min(1).describe('文档 ID') }),
      outputSchema: z.object({
        document_id: z.string(),
        title: z.string(),
        nodes: z.array(treeNodeSchema)
      }),
      annotations: readAnnotations()
    },
    ({ document_id }) => {
      const source = services.listSources().find((item) => item.id === document_id)
      if (!source) return failure('文档不存在，请先调用 doc_hub_list_documents 获取有效 ID')
      const files = services.listDocuments().filter((document) => document.sourceId === document_id)
      return result(
        { document_id, title: source.name, nodes: buildUrlTree(files, document_id) },
        `${source.name}：${files.length} 个文件`
      )
    }
  )

  server.registerTool(
    'doc_hub_read_files',
    {
      title: '读取文档文件',
      description:
        '读取从目录或搜索结果中选出的 Markdown 文件，可批量读取不同文档库的文件。回答问题前应读取完整文件，而不是只依赖搜索片段。',
      inputSchema: z.object({
        file_ids: z.array(z.string().min(1)).min(1).max(20).describe('最多 20 个文件 ID'),
        max_chars_per_file: z.number().int().min(1000).max(100000).default(30000)
      }),
      annotations: readAnnotations()
    },
    ({ file_ids, max_chars_per_file }) => {
      const documents = new Map(services.listDocuments().map((document) => [document.id, document]))
      const files = file_ids.flatMap((id) => {
        const document = documents.get(id)
        if (!document) return []
        return [
          {
            id: document.id,
            document_id: document.sourceId,
            title: document.title,
            path: document.folder,
            source_url: document.url,
            language: document.language,
            updated_at: document.updatedAt,
            content: document.content.slice(0, max_chars_per_file),
            truncated: document.content.length > max_chars_per_file
          }
        ]
      })
      const notFound = file_ids.filter((id) => !documents.has(id))
      return result({ files, not_found: notFound }, `读取 ${files.length} 个文件`)
    }
  )

  server.registerTool(
    'doc_hub_search',
    {
      title: '搜索文档正文',
      description:
        '使用本地 FTS5 搜索标题和 Markdown 正文，返回最佳匹配段落及文件 ID。目录无法定位或用户明确给出关键词时使用，随后调用 doc_hub_read_files 阅读完整文件。',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        document_ids: z.array(z.string().min(1)).max(20).optional(),
        ...paginationSchema
      }),
      annotations: readAnnotations()
    },
    ({ query, document_ids, offset, limit }) => {
      const scope = document_ids ? new Set(document_ids) : undefined
      const matches = services
        .searchDocuments(query)
        .filter((document) => !scope || scope.has(document.sourceId))
      const hits = matches.slice(offset, offset + limit).map((document) => {
        const passage = findBestPassage(document.content, query, document.title)
        return {
          file_id: document.id,
          document_id: document.sourceId,
          file_title: document.title,
          section_title: passage.sectionTitle,
          path: document.folder,
          source_url: document.url,
          paragraph: passage.paragraph,
          truncated: passage.truncated
        }
      })
      return result(page(hits, matches.length, offset, limit), `找到 ${matches.length} 个匹配文件`)
    }
  )

  server.registerTool(
    'doc_hub_delete_document',
    {
      title: '删除本地文档',
      description:
        '永久删除整个文档库及其文件和搜索索引。不能删除单个同步文件；仅在用户明确要求删除时调用。',
      inputSchema: z.object({ document_id: z.string().min(1) }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    ({ document_id }) => {
      const source = services.listSources().find((item) => item.id === document_id)
      if (!source) return result({ deleted: false, document_id }, '文档已经不存在')
      if (services.isCrawling(document_id)) return failure('文档正在更新，完成后才能删除')
      services.deleteSource(document_id)
      return result({ deleted: true, document_id }, `已删除 ${source.name}`)
    }
  )

  return server
}

function page<T>(
  items: T[],
  total: number,
  offset: number,
  limit: number
): Record<string, unknown> {
  const hasMore = offset + items.length < total
  return {
    total_count: total,
    count: items.length,
    offset,
    items,
    has_more: hasMore,
    ...(hasMore ? { next_offset: offset + limit } : {})
  }
}

function result(
  output: Record<string, unknown>,
  summary: string
): {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  return { content: [{ type: 'text' as const, text: summary }], structuredContent: output }
}

function failure(message: string): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
} {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

function readAnnotations(): {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
} {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
