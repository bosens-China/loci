import type {
  CloudCatalogItem,
  CloudImportResult,
  CreateSourceInput,
  CrawlProgress,
  CrawlRunState,
  DocumentRecord,
  DocumentSource
} from '@loci/shared'

// MCP 仅依赖宿主能力接口，CLI 与桌面端可各自注入实现。
export interface LociMcpServices {
  listSources: () => DocumentSource[]
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string) => DocumentRecord[]
  createSource: (input: CreateSourceInput) => DocumentSource
  crawlSource: (
    id: string,
    onProgress?: (progress: CrawlProgress) => void
  ) => Promise<CrawlProgress>
  deleteSource: (id: string) => void
  isCrawling: (id: string) => boolean
  getCrawlState: (id: string) => CrawlRunState | undefined
  listCloudLibraries: () => Promise<CloudCatalogItem[]>
  pullCloudLibrary: (libraryId: string) => Promise<CloudImportResult>
}
