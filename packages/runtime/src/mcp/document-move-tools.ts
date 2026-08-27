import * as z from 'zod/v4'
import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS } from '@loci/core'
import { failure, result, serializeLibrary, writeAnnotations } from './server-support.js'
import type { LociMcpServices } from './server.js'
import type { LociToolRegistrar } from './tool-registry.js'

export function registerDocumentMoveTools(
  register: LociToolRegistrar,
  services: LociMcpServices
): void {
  register(
    'loci_move_documents_to_new_library',
    {
      title: '移动多篇文档到新文档库',
      description:
        '事务性创建新文档库、复制所选正文并从原库删除；原库为空时可一并删除。operation_id 用于跨进程重试复用。调用前必须确认。',
      inputSchema: z
        .object({
          document_ids: z.array(z.string().trim().min(1)).min(1).max(1_000),
          name: z.string().trim().min(1).max(DOCUMENT_SOURCE_LIMITS.nameLength.max),
          url: z.string().url(),
          scope_path: z.string().default(DOCUMENT_SOURCE_DEFAULTS.scopePath),
          page_limit: z
            .number()
            .int()
            .min(DOCUMENT_SOURCE_LIMITS.pageLimit.min)
            .max(DOCUMENT_SOURCE_LIMITS.pageLimit.max)
            .default(DOCUMENT_SOURCE_DEFAULTS.pageLimit),
          delete_empty_sources: z.boolean().default(true),
          operation_id: z.string().trim().min(1).optional()
        })
        .strict(),
      outputSchema: z.object({
        operation_id: z.string(),
        target: z.record(z.string(), z.unknown()),
        moved: z.number().int().nonnegative(),
        deleted_source_ids: z.array(z.string()),
        reused: z.boolean()
      }),
      annotations: writeAnnotations(true)
    },
    async (input) => {
      try {
        const moved = services.moveDocumentsToNewSource({
          operationId: input.operation_id,
          documentIds: input.document_ids,
          deleteEmptySources: input.delete_empty_sources,
          target: {
            name: input.name,
            url: input.url,
            mode: 'auto',
            pageLimit: input.page_limit,
            scopePath: input.scope_path,
            schedule: null,
            httpConcurrency: null,
            browserConcurrency: null
          }
        })
        return result(
          {
            operation_id: moved.operationId,
            target: serializeLibrary(moved.target),
            moved: moved.moved,
            deleted_source_ids: moved.deletedSourceIds,
            reused: moved.reused
          },
          `${moved.reused ? '已复用' : '已完成'}移动，共 ${moved.moved} 篇文档`
        )
      } catch (error) {
        return failure(error instanceof Error ? error.message : '文档移动失败')
      }
    }
  )
}
