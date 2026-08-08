import type {
  CloudCatalogItem,
  CloudImportResult,
  CreateSourceInput,
  CrawlProgress,
  CrawlRunState,
  CrawlFailure,
  DocumentRecord,
  DocumentSource
} from '@loci/shared'
import type { DocumentSearchMode } from '../document-content-database.js'

// MCP 仅依赖宿主能力接口，CLI 与桌面端可各自注入实现。
export interface LociMcpServices {
  listSources: () => DocumentSource[]
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string, mode?: DocumentSearchMode) => DocumentRecord[]
  createSource: (input: CreateSourceInput) => DocumentSource
  crawlSource: (
    id: string,
    onProgress?: (progress: CrawlProgress) => void
  ) => Promise<CrawlProgress>
  deleteSource: (id: string) => void
  isCrawling: (id: string) => boolean
  getCrawlState: (id: string) => CrawlRunState | undefined
  getLatestCrawlRunId: (libraryId: string) => string | undefined
  getCrawlRunLibraryId: (runId: string) => string | undefined
  listCrawlFailures: (runId: string) => CrawlFailure[]
  listCloudLibraries: () => Promise<CloudCatalogItem[]>
  pullCloudLibrary: (libraryId: string) => Promise<CloudImportResult>
}
