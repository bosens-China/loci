import type {
  CreateSourceInput,
  DocumentSource,
  ForegroundCrawlState,
  LibraryCrawlStatus,
  LibraryFilters,
  LibrarySummary,
  SourceInspection,
  UpdateSourceInput
} from '@loci/shared'
import { request } from './client'

/** 查询所有本地文档库，可选 query 按名字、ID 或 URL 匹配。 */
export const listLibraries = async (
  filters?: LibraryFilters | string
): Promise<LibrarySummary[]> => {
  const { data } = await request.get<LibrarySummary[]>('/api/libraries', {
    params: typeof filters === 'string' ? { query: filters } : filters
  })
  return data
}

/** 获取单个文档库详情。 */
export const getLibrary = async (id: string): Promise<LibrarySummary> => {
  const { data } = await request.get<LibrarySummary>(`/api/libraries/${encodeURIComponent(id)}`)
  return data
}

/** 创建新的文档库。 */
export const createLibrary = async (input: CreateSourceInput): Promise<DocumentSource> => {
  const { data } = await request.post<DocumentSource>('/api/libraries', input)
  return data
}

/** 完整更新文档库配置。 */
export const updateLibrary = async (
  id: string,
  input: UpdateSourceInput
): Promise<DocumentSource> => {
  const { data } = await request.put<DocumentSource>(
    `/api/libraries/${encodeURIComponent(id)}`,
    input
  )
  return data
}

/** 删除指定文档库。 */
export const deleteLibrary = async (id: string): Promise<{ deleted: boolean }> => {
  const { data } = await request.delete<{ deleted: boolean }>(
    `/api/libraries/${encodeURIComponent(id)}`
  )
  return data
}

/** 探测指定 URL 的内容结构与预估页面规模。 */
export const inspectSource = async (input: {
  url: string
  scopePath?: string
  excludePathPattern?: string | null
}): Promise<SourceInspection> => {
  const { data } = await request.post<SourceInspection>('/api/inspect', input)
  return data
}

/** 触发全量抓取或更新。 */
export const syncLibrary = async (id: string): Promise<ForegroundCrawlState> => {
  const { data } = await request.post<ForegroundCrawlState>(
    `/api/libraries/${encodeURIComponent(id)}/sync`
  )
  return data
}

/** 精确抓取指定的一个或多个页面。 */
export const fetchLibraryPages = async (
  id: string,
  urls: string[]
): Promise<ForegroundCrawlState> => {
  const { data } = await request.post<ForegroundCrawlState>(
    `/api/libraries/${encodeURIComponent(id)}/pages`,
    { urls }
  )
  return data
}

/** 查询当前服务在途的抓取任务状态。 */
export const getLibraryCrawl = async (id: string): Promise<ForegroundCrawlState | null> => {
  const { data } = await request.get<ForegroundCrawlState | null>(
    `/api/libraries/${encodeURIComponent(id)}/crawl`
  )
  return data
}

/** 查询所有库的最新抓取记录（跨进程持久化状态）。 */
export const listLibraryCrawlStatuses = async (): Promise<LibraryCrawlStatus[]> => {
  const { data } = await request.get<LibraryCrawlStatus[]>('/api/libraries/crawl-status')
  return data
}

/** 查询单个库的最新抓取记录。 */
export const getLibraryCrawlStatus = async (id: string): Promise<LibraryCrawlStatus | null> => {
  const { data } = await request.get<LibraryCrawlStatus | null>(
    `/api/libraries/${encodeURIComponent(id)}/crawl-status`
  )
  return data
}

/** 取消正在运行的抓取任务。 */
export const cancelLibraryCrawl = async (id: string): Promise<ForegroundCrawlState | null> => {
  const { data } = await request.post<ForegroundCrawlState | null>(
    `/api/libraries/${encodeURIComponent(id)}/crawl/cancel`
  )
  return data
}
