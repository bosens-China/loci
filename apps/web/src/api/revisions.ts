import type { ResourceRevisions } from '@loci/shared'
import { request } from '@/api/client'

export async function getResourceRevisions(): Promise<ResourceRevisions> {
  return (await request.get<ResourceRevisions>('/api/revisions')).data
}
