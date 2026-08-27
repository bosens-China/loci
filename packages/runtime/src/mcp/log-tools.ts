import type { OperationLog } from '@loci/shared'
import * as z from 'zod/v4'
import { page, readAnnotations, result } from './server-support.js'
import type { LociMcpServices } from './services.js'
import type { LociToolRegistrar } from './tool-registry.js'

const logSchema = z.object({
  id: z.number().int(),
  category: z.enum(['task', 'library', 'settings', 'cloud', 'maintenance', 'system']),
  action: z.string(),
  level: z.enum(['info', 'warning', 'error']),
  resource_type: z.string().nullable(),
  resource_id: z.string().nullable(),
  hostname: z.string().nullable(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string()
})

export function registerLogTools(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_list_operation_logs',
    {
      title: '查看 Loci 操作日志',
      description: '按日期、分类、级别或 hostname 查看结构化操作记录。',
      inputSchema: z.object({
        date: z.iso.date().optional(),
        category: z
          .enum(['task', 'library', 'settings', 'cloud', 'maintenance', 'system'])
          .optional(),
        level: z.enum(['info', 'warning', 'error']).optional(),
        hostname: z.string().trim().min(1).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20)
      }),
      outputSchema: z.object({
        total_count: z.number().int(),
        count: z.number().int(),
        offset: z.number().int(),
        items: z.array(logSchema),
        has_more: z.boolean(),
        next_offset: z.number().int().optional()
      }),
      annotations: readAnnotations()
    },
    ({ offset, limit, ...filters }) => {
      const response = services.listOperationLogs({ ...filters, offset, limit })
      return result(
        page(response.items.map(serializeLog), response.total, offset, limit),
        `找到 ${response.total} 条操作记录`
      )
    }
  )
}

function serializeLog(item: OperationLog): z.output<typeof logSchema> {
  return {
    id: item.id,
    category: item.category,
    action: item.action,
    level: item.level,
    resource_type: item.resourceType,
    resource_id: item.resourceId,
    hostname: item.hostname,
    message: item.message,
    details: item.details,
    created_at: item.createdAt
  }
}
