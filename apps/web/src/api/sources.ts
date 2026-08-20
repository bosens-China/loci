import type { CreateSourceInput, DocumentSource, UpdateSourceInput } from '@loci/shared'
import { request } from '@/api/client'

export async function listSources(): Promise<DocumentSource[]> {
  return (await request.get<DocumentSource[]>('/api/sources')).data
}

export async function createSource(input: CreateSourceInput): Promise<DocumentSource> {
  return (await request.post<DocumentSource>('/api/sources', input)).data
}

export async function updateSource(id: string, input: UpdateSourceInput): Promise<DocumentSource> {
  return (await request.put<DocumentSource>(`/api/sources/${encodeURIComponent(id)}`, input)).data
}

export async function deleteSource(id: string): Promise<void> {
  await request.delete(`/api/sources/${encodeURIComponent(id)}`)
}
