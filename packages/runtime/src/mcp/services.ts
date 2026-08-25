import type {
  CloudCatalogItem,
  CloudImportResult,
  CreateSourceInput,
  CrawlProgress,
  CrawlRunState,
  CrawlFailure,
  DocumentRecord,
  DocumentSource,
  UpdateSourceInput
} from '@loci/shared'
import type { InspectSourceOptions, SourceInspection } from '@loci/core'
import type { DocumentSearchMode } from '../document-content-database.js'
import type { ExplicitPageFetchResult } from '../explicit-page-service.js'

// MCP 仅依赖宿主能力接口，CLI 与后台服务可各自注入实现。
export interface LociMcpServices {
  listSources: () => DocumentSource[]
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string, mode?: DocumentSearchMode) => DocumentRecord[]
  createSource: (input: CreateSourceInput) => DocumentSource
  inspectSource: (input: InspectSourceOptions) => Promise<SourceInspection>
  updateSource: (
    source: DocumentSource,
    input: Omit<UpdateSourceInput, 'schedule'>
  ) => DocumentSource
  crawlSource: (
    id: string,
    onProgress?: (progress: CrawlProgress) => void
  ) => Promise<CrawlProgress>
  fetchPages: (id: string, urls: readonly string[]) => Promise<ExplicitPageFetchResult>
  deleteSource: (id: string) => void
  isCrawling: (id: string) => boolean
  getCrawlState: (id: string) => CrawlRunState | undefined
  getLatestCrawlRunId: (libraryId: string) => string | undefined
  getCrawlRunLibraryId: (runId: string) => string | undefined
  listCrawlFailures: (runId: string) => CrawlFailure[]
  listCloudLibraries: () => Promise<CloudCatalogItem[]>
  pullCloudLibrary: (libraryId: string) => Promise<CloudImportResult>
}
