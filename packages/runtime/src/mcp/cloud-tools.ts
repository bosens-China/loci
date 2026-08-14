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
