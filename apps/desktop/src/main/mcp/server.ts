import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { buildUrlTree, getUrlTreeSlice } from '@loci/shared'
import type {
  CreateSourceInput,
  CloudCatalogItem,
  CloudImportResult,
  CrawlProgress,
  CrawlRunState,
  DocumentRecord,
  DocumentSource
} from '@loci/shared'
import { registerCloudTools } from './cloud-tools'
import { findBestPassage, readMarkdownSection, sliceContent } from './content'
import {
  addLibraryOutputSchema,
  deleteLibraryOutputSchema,
  listLibrariesOutputSchema,
  paginationInput,
  readFilesOutputSchema,
  searchOutputSchema,
  syncLibrariesOutputSchema,
  syncStatusOutputSchema,
  treeOutputSchema
} from './schemas'
import {
  failure,
  page,
  readAnnotations,
  renderFiles,
  result,
  serializeLibrary,
  startInBackground,
  stateToSyncItem,
  syncSummary,
  waitForSync,
  writeAnnotations
} from './server-support'

export interface LociMcpServices {
  listSources: () => DocumentSource[]
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string) => DocumentRecord[]
  createSource: (input: CreateSourceInput) => DocumentSource
  crawlSource: (
    id: string,
    onProgress?: (progress: CrawlProgress) => void
  ) => Promise<CrawlProgress>
  deleteSource: (id: string) => void
  isCrawling: (id: string) => boolean
  getCrawlState: (id: string) => CrawlRunState | undefined
  listCloudLibraries: () => Promise<CloudCatalogItem[]>
  pullCloudLibrary: (libraryId: string) => Promise<CloudImportResult>
}

const WAIT_DESCRIPTION =
  '默认立即返回 syncing；需要在单次调用内等待结果时传 wait_for_completion=true，并设置客户端进度回调。'

// 所有工具只编排现有本地服务，MCP 层不维护第二份文档或抓取状态。
export function createLociMcpServer(services: LociMcpServices): McpServer {
  const server = new McpServer({ name: 'loci-mcp-server', version: '1.1.0' })

  server.registerTool(
    'loci_add_library',
    {
      title: '添加网页文档库',
      description: `创建文档库并抓取同 hostname 页面。相同 hostname 只返回已有文档库。${WAIT_DESCRIPTION}`,
      inputSchema: z.object({
        url: z.url().describe('任意公开文档页面 URL'),
        name: z.string().trim().min(1).max(100).optional().describe('默认使用 hostname'),
        http_concurrency: z
          .number()
          .int()
          .min(1)
          .max(32)
          .optional()
          .describe('省略时使用全局 HTTP 默认值'),
        browser_concurrency: z
          .number()
          .int()
          .min(1)
          .max(32)
          .optional()
          .describe('省略时使用全局浏览器默认值'),
        wait_for_completion: z.boolean().default(false)
      }),
      outputSchema: addLibraryOutputSchema,
      annotations: writeAnnotations(true)
    },
    async ({ url, name, http_concurrency, browser_concurrency, wait_for_completion }, context) => {
      const hostname = new URL(url).hostname
      const existing = services
        .listSources()
        .find((item) => new URL(item.url).hostname === hostname)
      if (existing) {
        return result(
          {
            created: false,
            status: services.isCrawling(existing.id) ? 'syncing' : 'idle',
            library: serializeLibrary(
              existing,
              services.isCrawling(existing.id) ? 'syncing' : undefined
            )
          },
          services.isCrawling(existing.id) ? '文档库正在同步' : '文档库已存在'
        )
      }

      const source = services.createSource({
        name: name ?? hostname,
        url,
        mode: 'auto',
        pageLimit: 1000,
        schedule: null,
        httpConcurrency: http_concurrency ?? null,
        browserConcurrency: browser_concurrency ?? null
      })
      if (!wait_for_completion) {
        startInBackground(services, source.id)
        return result(
          { created: true, status: 'syncing', library: serializeLibrary(source, 'syncing') },
          '文档库已创建并开始同步；请调用 loci_get_sync_status 查询进度'
        )
      }
      const item = await waitForSync(services, source.id, context)
      const sync = { ...item }
      delete sync.library_id
      const library = services.listSources().find((entry) => entry.id === source.id) ?? source
      return result(
        { created: true, ...sync, library: serializeLibrary(library) },
        `文档库同步状态：${item.status}`
      )
    }
  )

  server.registerTool(
    'loci_sync_libraries',
    {
      title: '同步网页文档库',
      description: `按文档库 ID 重新拉取网页内容；新增页面会写入，404/410 页面会移除。${WAIT_DESCRIPTION}`,
      inputSchema: z.object({
        library_ids: z.array(z.string().min(1)).min(1).max(10),
        wait_for_completion: z.boolean().default(false)
      }),
      outputSchema: syncLibrariesOutputSchema,
      annotations: writeAnnotations(false)
    },
    async ({ library_ids, wait_for_completion }, context) => {
      const available = new Set(services.listSources().map((source) => source.id))
      const items: Array<Record<string, unknown>> = []
      for (const id of new Set(library_ids)) {
        if (!available.has(id)) {
          items.push({ library_id: id, status: 'not_found' })
        } else if (services.isCrawling(id)) {
          items.push({ library_id: id, status: 'syncing' })
        } else if (wait_for_completion) {
          items.push(await waitForSync(services, id, context))
        } else {
          startInBackground(services, id)
          items.push({ library_id: id, status: 'syncing' })
        }
      }
      return result({ items }, items.map(syncSummary).join('\n'))
    }
  )

  server.registerTool(
    'loci_get_sync_status',
    {
      title: '查看文档库同步状态',
      description: '轮询一个或多个文档库的同步进度、失败页面和可重试信息。',
      inputSchema: z.object({ library_ids: z.array(z.string().min(1)).min(1).max(20) }),
      outputSchema: syncStatusOutputSchema,
      annotations: readAnnotations()
    },
    ({ library_ids }) => {
      const available = new Set(services.listSources().map((source) => source.id))
      const items = [...new Set(library_ids)].map((id) =>
        available.has(id)
          ? stateToSyncItem(id, services.getCrawlState(id), services.isCrawling(id))
          : { library_id: id, status: 'not_found' }
      )
      return result({ items }, items.map(syncSummary).join('\n'))
    }
  )

  server.registerTool(
    'loci_list_libraries',
    {
      title: '查看本地文档库',
      description: '分页列出文档库。query 可省略，只匹配文档库名称和来源 URL，不搜索正文。',
      inputSchema: z.object({
        query: z.string().trim().max(200).optional(),
        ...paginationInput
      }),
      outputSchema: listLibrariesOutputSchema,
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
      const items = matches
        .slice(offset, offset + limit)
        .map((source) =>
          serializeLibrary(source, services.isCrawling(source.id) ? 'syncing' : undefined)
        )
      return result(page(items, matches.length, offset, limit), `找到 ${matches.length} 个文档库`)
    }
  )

  registerCloudTools(server, services)

  server.registerTool(
    'loci_get_library_tree',
    {
      title: '查看文档库目录',
      description:
        '按层返回 URL 目录。用 parent_id 展开目录，再选择 readable=true 的文件 ID 阅读。',
      inputSchema: z.object({
        library_id: z.string().min(1),
        parent_id: z.string().min(1).optional(),
        depth: z.number().int().min(1).max(5).default(2)
      }),
      outputSchema: treeOutputSchema,
      annotations: readAnnotations()
    },
    ({ library_id, parent_id, depth }) => {
      const source = services.listSources().find((item) => item.id === library_id)
      if (!source) return failure('文档库不存在，请先调用 loci_list_libraries 获取有效 ID')
      const files = services.listDocuments().filter((document) => document.sourceId === library_id)
      const nodes = getUrlTreeSlice(buildUrlTree(files, library_id), parent_id, depth)
      if (!nodes) return failure('parent_id 不存在或不是目录节点')
      return result(
        { library_id, title: source.name, ...(parent_id ? { parent_id } : {}), depth, nodes },
        `${source.name}：返回 ${nodes.length} 个当前层级节点`
      )
    }
  )

  server.registerTool(
    'loci_read_files',
    {
      title: '读取文档文件',
      description:
        '批量读取 Markdown 文件；offset + next_offset 可续读。传 section_id 时仅允许一个 file_id，并读取搜索命中的完整小节。',
      inputSchema: z.object({
        file_ids: z.array(z.string().min(1)).min(1).max(20),
        section_id: z.string().min(1).optional(),
        offset: z.number().int().min(0).default(0),
        max_chars_per_file: z.number().int().min(1000).max(50000).default(12000)
      }),
      outputSchema: readFilesOutputSchema,
      annotations: readAnnotations()
    },
    ({ file_ids, section_id, offset, max_chars_per_file }) => {
      const ids = [...new Set(file_ids)]
      if (section_id && ids.length !== 1) return failure('section_id 只能和一个 file_id 一起使用')
      const documents = new Map(services.listDocuments().map((document) => [document.id, document]))
      const perFileLimit = Math.min(max_chars_per_file, Math.floor(60000 / ids.length))
      const files = ids.flatMap((id) => {
        const document = documents.get(id)
        if (!document) return []
        const section = section_id
          ? readMarkdownSection(document.content, section_id, id, document.title)
          : undefined
        if (section_id && !section) return []
        const slice = sliceContent(section?.content ?? document.content, offset, perFileLimit)
        return [
          {
            id,
            library_id: document.sourceId,
            title: document.title,
            ...(section_id ? { section_id, section_title: section?.title } : {}),
            path: document.folder,
            source_url: document.url,
            language: document.language,
            updated_at: document.updatedAt,
            content: slice.content,
            offset: slice.offset,
            ...(slice.nextOffset === undefined ? {} : { next_offset: slice.nextOffset }),
            total_chars: slice.totalChars,
            truncated: slice.truncated
          }
        ]
      })
      const notFound = ids.filter((id) => !documents.has(id) || (section_id && files.length === 0))
      return result(
        { files, not_found: notFound },
        `读取 ${files.length} 个文件`,
        renderFiles(files)
      )
    }
  )

  server.registerTool(
    'loci_search_files',
    {
      title: '搜索文件正文',
      description:
        '搜索标题和 Markdown 正文，返回段落、section_id 和 file_id；随后可直接读取命中小节。',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        library_ids: z.array(z.string().min(1)).max(20).optional(),
        ...paginationInput
      }),
      outputSchema: searchOutputSchema,
      annotations: readAnnotations()
    },
    ({ query, library_ids, offset, limit }) => {
      const scope = library_ids ? new Set(library_ids) : undefined
      const matches = services
        .searchDocuments(query)
        .filter((document) => !scope || scope.has(document.sourceId))
      const hits = matches.slice(offset, offset + limit).map((document) => {
        const passage = findBestPassage(document.content, query, document.title, document.id)
        return {
          file_id: document.id,
          library_id: document.sourceId,
          file_title: document.title,
          section_id: passage.sectionId,
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
    'loci_delete_library',
    {
      title: '删除本地文档库',
      description: '永久删除整个文档库及文件和搜索索引；仅在用户明确要求时调用。',
      inputSchema: z.object({ library_id: z.string().min(1) }),
      outputSchema: deleteLibraryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    ({ library_id }) => {
      const source = services.listSources().find((item) => item.id === library_id)
      if (!source) return result({ deleted: false, library_id }, '文档库已经不存在')
      if (services.isCrawling(library_id)) return failure('文档库正在同步，完成后才能删除')
      services.deleteSource(library_id)
      return result({ deleted: true, library_id }, `已删除 ${source.name}`)
    }
  )

  return server
}
