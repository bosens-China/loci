import type { LibraryFileRecord, UrlTreeNode } from '@loci/shared'
import { request } from '@/api/client'

export type LibraryLocation = 'local' | 'cloud'

export async function getLibraryTree(
  location: LibraryLocation,
  libraryId: string,
  parentId?: string
): Promise<{ libraryId: string; title: string; parentId: string | null; nodes: UrlTreeNode[] }> {
  const prefix = location === 'local' ? '/api/libraries' : '/api/cloud/libraries'
  return (
    await request.get(`${prefix}/${encodeURIComponent(libraryId)}/tree`, {
      params: { depth: 1, ...(parentId ? { parent_id: parentId } : {}) }
    })
  ).data
}

export async function readLibraryFile(
  location: LibraryLocation,
  libraryId: string,
  fileId: string
): Promise<LibraryFileRecord> {
  const prefix = location === 'local' ? '/api/libraries' : '/api/cloud/libraries'
  const response = (
    await request.get(
      `${prefix}/${encodeURIComponent(libraryId)}/files/${encodeURIComponent(fileId)}`,
      { params: { offset: 0, max_chars: 50_000 } }
    )
  ).data as LibraryFileRecord | { file: LibraryFileRecord }
  return 'file' in response ? response.file : response
}
