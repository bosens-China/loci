import * as z from 'zod/v4'
import type { CloudCatalogItem } from '@loci/shared'
import {
  listCloudLibrariesOutputSchema,
  paginationInput,
  pullCloudLibraryOutputSchema
} from './schemas.js'
import {
  failure,
  page,
  remoteReadAnnotations,
  result,
  serializeLibrary,
  writeAnnotations
} from './server-support.js'
import type { LociMcpServices } from './server.js'
import type { LociToolRegistrar } from './tool-registry.js'

/** 注册访问公开 Loci Server 的工具，本地数据库读写仍由共享服务完成。 */
export function registerCloudTools(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_list_cloud_libraries',
    {
      title: '查询云端公开文档库',
      description:
        '查询当前 Loci Server 发布的公开文档库。仅在本地没有匹配文档库时调用；这是只读查询，不会下载内容。query 可省略，只匹配名称和来源 URL。',
      inputSchema: z
        .object({
          query: z.string().trim().max(200).optional(),
          ...paginationInput
        })
        .strict(),
      outputSchema: listCloudLibrariesOutputSchema,
      annotations: remoteReadAnnotations()
    },
    async ({ query, offset, limit }) => {
      try {
        const keyword = query?.toLocaleLowerCase()
        const catalog = await services.listCloudLibraries()
        const matches = catalog.filter(
          (item) =>
            !keyword ||
            item.name.toLocaleLowerCase().includes(keyword) ||
            item.url.toLocaleLowerCase().includes(keyword)
        )
        const items = matches
          .slice(offset, offset + limit)
          .map((item) => serializeCloudLibrary(item))
        return result(
          page(items, matches.length, offset, limit),
          `云端找到 ${matches.length} 个文档库`
        )
      } catch (error) {
        return failure(`云端目录查询失败：${errorMessage(error)}。请检查 Server 地址和网络连接`)
      }
    }
  )

  register(
    'loci_get_cloud_library_tree',
    {
      title: '读取云端文档库目录',
      description: '按目录和深度读取云端文档库结构，不下载正文。先读取一级，再按需展开子目录。',
      inputSchema: z
        .object({
          library_id: z.string().trim().min(1),
          parent: z.string().trim().optional(),
          depth: z.number().int().min(1).max(10).default(1)
        })
        .strict(),
      outputSchema: z.object({ tree: z.array(z.record(z.string(), z.unknown())) }),
      annotations: remoteReadAnnotations()
    },
    async ({ library_id, parent, depth }) => {
      try {
        const tree = await services.getCloudLibraryTree(library_id, parent, depth)
        return result({ tree }, `已读取 ${tree.length} 个云端目录节点`)
      } catch (error) {
        return failure(`云端目录读取失败：${errorMessage(error)}`)
      }
    }
  )

  register(
    'loci_read_cloud_library_file',
    {
      title: '读取云端文档正文',
      description: '按 file_id 和字符区间读取云端正文；正文较长时根据 next_offset 继续读取。',
      inputSchema: z
        .object({
          library_id: z.string().trim().min(1),
          file_id: z.string().trim().min(1),
          offset: z.number().int().min(0).default(0),
          max_chars: z.number().int().min(1_000).max(50_000).default(20_000)
        })
        .strict(),
      outputSchema: z.object({ file: z.record(z.string(), z.unknown()) }),
      annotations: remoteReadAnnotations()
    },
    async ({ library_id, file_id, offset, max_chars }) => {
      try {
        const file = await services.readCloudLibraryFile(library_id, file_id, offset, max_chars)
        return result({ file }, file.truncated ? '已读取部分正文，可继续读取' : '已读取完整正文')
      } catch (error) {
        return failure(`云端正文读取失败：${errorMessage(error)}`)
      }
    }
  )

  register(
    'loci_pull_cloud_library',
    {
      title: '拉取云端公开文档库',
      description:
        '从当前 Loci Server 下载公开快照并保存到本地；重复调用会更新已有副本。该操作会访问网络并修改本地数据库，调用前必须取得用户确认。',
      inputSchema: z
        .object({
          library_id: z.string().trim().min(1).describe('来自 loci_list_cloud_libraries 的云端 ID')
        })
        .strict(),
      outputSchema: pullCloudLibraryOutputSchema,
      annotations: writeAnnotations(true)
    },
    async ({ library_id }) => {
      try {
        const imported = await services.pullCloudLibrary(library_id)
        return result(
          {
            updated: imported.updated,
            documents: imported.documents,
            library: serializeLibrary(imported.source)
          },
          imported.updated
            ? `云端文档库已保存，共 ${imported.documents} 篇文档`
            : '本地云端副本已经是最新版本'
        )
      } catch (error) {
        return failure(`云端文档库拉取失败：${errorMessage(error)}。请重新查询云端目录后再试`)
      }
    }
  )

  register(
    'loci_publish_library_to_server',
    {
      title: '发布本地文档库到 Server',
      description:
        '把一个本地文档库作为校验过的压缩二进制归档发布到当前 Server。create 创建新公开库；replace 必须明确指定目标。调用前必须取得用户确认。',
      inputSchema: z
        .object({
          library_id: z.string().trim().min(1),
          mode: z.enum(['create', 'replace']),
          target_library_id: z.string().trim().min(1).optional()
        })
        .strict()
        .refine(
          (input) => input.mode === 'create' || Boolean(input.target_library_id),
          '覆盖发布必须指定 target_library_id'
        ),
      outputSchema: z.object({ publish: z.record(z.string(), z.unknown()) }),
      annotations: writeAnnotations(true)
    },
    async ({ library_id, mode, target_library_id }) => {
      try {
        const published = await services.publishLocalLibrary(library_id, mode, target_library_id)
        return result(
          { publish: published },
          `${published.reused ? '已复用' : '已完成'}发布：${published.library.name}`
        )
      } catch (error) {
        return failure(`文档库发布失败：${errorMessage(error)}`)
      }
    }
  )
}

function serializeCloudLibrary(item: CloudCatalogItem): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    url: item.url,
    revision: item.revision,
    pages: item.pages,
    content_size: item.contentSize,
    last_crawled_at: item.lastCrawledAt,
    published_at: item.publishedAt,
    local_source_id: item.localSourceId,
    local_revision: item.localRevision,
    auto_sync: item.autoSync,
    update_available: item.updateAvailable
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
