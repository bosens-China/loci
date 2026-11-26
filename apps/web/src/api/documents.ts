import type {
  CreateDocumentInput,
  DocumentDetail,
  DocumentReadInput,
  DocumentReadResult,
  DocumentRecord,
  DocumentSearchInput,
  DocumentSearchResult,
  DocumentSectionDetail,
  EditDocumentSectionInput,
  LibraryTreeOptions,
  UpdateDocumentInput,
  UrlTreeNode
} from '@loci/shared'
import { request } from './client'

/** 查询文档库的目录树，支持单/多关键词筛选匹配。 */
export const getLibraryTree = async (
  libraryId: string,
  options?: LibraryTreeOptions
): Promise<UrlTreeNode[]> => {
  const params = new URLSearchParams()
  if (options?.parent) params.set('parent', options.parent)
  if (options?.depth !== undefined) params.set('depth', String(options.depth))
  if (options?.queries) {
    const list = Array.isArray(options.queries) ? options.queries : [options.queries]
    for (const q of list) {
      if (typeof q === 'string' && q.trim()) params.append('queries', q.trim())
    }
  }
  const { data } = await request.get<UrlTreeNode[]>(
    `/api/libraries/${encodeURIComponent(libraryId)}/tree`,
    { params }
  )
  return data
}

/** 跨库或指定库全文检索。 */
export const searchDocuments = async (
  input: DocumentSearchInput
): Promise<DocumentSearchResult> => {
  const { data } = await request.post<DocumentSearchResult>('/api/search', input)
  return data
}

/** 读取指定文档或小节的 Markdown 正文。 */
export const readDocuments = async (input: DocumentReadInput): Promise<DocumentReadResult[]> => {
  const { data } = await request.post<DocumentReadResult[]>('/api/read', input)
  return data
}

/** 批量或单篇删除指定文档。 */
export const deleteLibraryDocuments = async (
  libraryId: string,
  targets: string | string[]
): Promise<{ deleted: number }> => {
  const { data } = await request.delete<{ deleted: number }>(
    `/api/libraries/${encodeURIComponent(libraryId)}/documents`,
    { data: { targets } }
  )
  return data
}

/** 在指定库下新建文档。 */
export const createDocument = async (
  libraryId: string,
  input: CreateDocumentInput
): Promise<DocumentRecord> => {
  const { data } = await request.post<DocumentRecord>(
    `/api/libraries/${encodeURIComponent(libraryId)}/documents`,
    input
  )
  return data
}

/** 获取指定文档的完整详情（含完整 content 和 updatedAt）。 */
export const getDocument = async (docId: string): Promise<DocumentDetail> => {
  const { data } = await request.get<DocumentDetail>(`/api/documents/${encodeURIComponent(docId)}`)
  return data
}

/** 更新指定文档的正文或标题。 */
export const updateDocument = async (
  docId: string,
  input: UpdateDocumentInput
): Promise<DocumentRecord> => {
  const { data } = await request.put<DocumentRecord>(
    `/api/documents/${encodeURIComponent(docId)}`,
    input
  )
  return data
}

/** 获取指定文档的小节结构列表（含每个小节的完整 body 与 updatedAt）。 */
export const listDocumentSections = async (docId: string): Promise<DocumentSectionDetail[]> => {
  const { data } = await request.get<DocumentSectionDetail[]>(
    `/api/documents/${encodeURIComponent(docId)}/sections`
  )
  return data
}

/** 增、删、改指定文档的某个小节。 */
export const editDocumentSection = async (
  docId: string,
  input: EditDocumentSectionInput
): Promise<DocumentRecord> => {
  const { data } = await request.post<DocumentRecord>(
    `/api/documents/${encodeURIComponent(docId)}/sections`,
    input
  )
  return data
}
