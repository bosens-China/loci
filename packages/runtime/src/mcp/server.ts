import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { buildUrlTree, getUrlTreeSlice } from '@loci/shared'
import type { UrlTreeNode } from '@loci/shared'
import { registerCloudTools } from './cloud-tools.js'
import { registerDeleteLibraryTool } from './delete-tool.js'
import { readMarkdownSection, sliceContent } from './content.js'
import {
  listLibrariesOutputSchema,
  paginationInput,
  readFilesOutputSchema,
  treeOutputSchema,
  type TreeNodeOutput
} from './schemas.js'
import {
  failure,
  page,
  readAnnotations,
  renderFiles,
  result,
  serializeLibrary
} from './server-support.js'
import type { LociMcpServices } from './services.js'
import { registerSearchTool } from './search-tool.js'
import { registerSyncTools } from './sync-tools.js'

export type { LociMcpServices } from './services.js'

function withFileLanguages(
  nodes: readonly UrlTreeNode[],
  languages: ReadonlyMap<string, string>
): TreeNodeOutput[] {
  return nodes.map((node) => ({
    id: node.id,
    title: node.title,
    readable: node.readable,
    ...(node.readable ? { language: languages.get(node.id) ?? 'und' } : {}),
    ...(node.children ? { children: withFileLanguages(node.children, languages) } : {})
  }))
}

// 所有工具只编排现有本地服务，MCP 层不维护第二份文档或抓取状态。
export function createLociMcpServer(services: LociMcpServices): McpServer {
  const server = new McpServer({ name: 'loci-mcp-server', version: '1.1.0' })

  registerSyncTools(server, services)

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
      const items = matches.slice(offset, offset + limit).map(serializeLibrary)
      return result(page(items, matches.length, offset, limit), `找到 ${matches.length} 个文档库`)
    }
  )

  registerCloudTools(server, services)

  server.registerTool(
    'loci_get_library_tree',
    {
      title: '查看文档库目录',
      description:
        '按层返回 URL 目录、文档库语言集合和文件语言。根据 languages 组织搜索词；用 parent_id 展开目录，再选择 readable=true 的文件 ID 阅读。',
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
      const tree = getUrlTreeSlice(buildUrlTree(files, library_id), parent_id, depth)
      if (!tree) return failure('parent_id 不存在或不是目录节点')
      const languageByFile = new Map(files.map((file) => [file.id, file.language]))
      const languages = [...new Set(files.map((file) => file.language))].sort()
      const nodes = withFileLanguages(tree, languageByFile)
      return result(
        {
          library_id,
          title: source.name,
          languages,
          ...(parent_id ? { parent_id } : {}),
          depth,
          nodes
        },
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

  registerSearchTool(server, services)

  registerDeleteLibraryTool(server, services)

  return server
}
