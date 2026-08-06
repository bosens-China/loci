import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { deleteLibraryOutputSchema } from './schemas.js'
import type { LociMcpServices } from './services.js'
import { failure, result } from './server-support.js'

export function registerDeleteLibraryTool(server: McpServer, services: LociMcpServices): void {
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
}
