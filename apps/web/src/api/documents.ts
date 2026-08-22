import type { DocumentRecord, DocumentSummary } from '@loci/shared'
import { request } from '@/api/client'

export async function listDocuments(query = '', source = ''): Promise<DocumentSummary[]> {
  return (
    await request.get<DocumentSummary[]>('/api/documents', {
      params: { ...(query ? { query } : {}), ...(source ? { source } : {}) }
    })
  ).data
}

export async function getDocument(id: string): Promise<DocumentRecord> {
  return (await request.get<DocumentRecord>(`/api/documents/${encodeURIComponent(id)}`)).data
}
