import type { CloudCatalogItem, CloudImportResult } from '@loci/shared'
import { request } from '@/api/client'

export async function listCloudCatalog(): Promise<CloudCatalogItem[]> {
  return (await request.get<CloudCatalogItem[]>('/api/cloud/catalog')).data
}

export async function pullCloudLibrary(
  libraryId: string,
  autoSync = true
): Promise<CloudImportResult> {
  return (
    await request.post<CloudImportResult>(
      `/api/cloud/libraries/${encodeURIComponent(libraryId)}/pull`,
      { autoSync },
      { timeout: 120_000 }
    )
  ).data
}

export async function updateCloudLibrary(sourceId: string): Promise<CloudImportResult> {
  return (
    await request.post<CloudImportResult>(
      `/api/cloud/sources/${encodeURIComponent(sourceId)}/update`,
      undefined,
      { timeout: 120_000 }
    )
  ).data
}

export async function setCloudAutoSync(sourceId: string, enabled: boolean): Promise<void> {
  await request.put(`/api/cloud/sources/${encodeURIComponent(sourceId)}/auto-sync`, { enabled })
}
