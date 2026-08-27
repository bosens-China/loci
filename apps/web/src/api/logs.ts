import type { OperationLog } from '@loci/shared'
import { request } from '@/api/client'

export interface OperationLogQuery {
  date?: string
  category?: OperationLog['category']
  level?: OperationLog['level']
  hostname?: string
  offset?: number
  limit?: number
}

export async function listOperationLogs(
  query: OperationLogQuery
): Promise<{ total: number; items: OperationLog[] }> {
  return (await request.get('/api/logs', { params: query })).data as {
    total: number
    items: OperationLog[]
  }
}
