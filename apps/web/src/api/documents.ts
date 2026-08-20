import type { DocumentRecord } from '@loci/shared'
import { request } from '@/api/client'

export async function listDocuments(query = '', source = ''): Promise<DocumentRecord[]> {
  return (
    await request.get<DocumentRecord[]>('/api/documents', {
      params: { ...(query ? { query } : {}), ...(source ? { source } : {}) }
    })
  ).data
}
