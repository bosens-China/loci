export type {
  CreateSourceInput,
  CrawlProgress,
  CrawlNode,
  CrawlProgressEvent,
  CrawlRunState,
  CrawlNodeStatus,
  DocumentRecord,
  DocumentSource,
  FetchMode,
  SourceStatus,
  UpdateSourceInput
} from '../../shared/api'

export type ViewKey = 'overview' | 'sources' | 'library' | 'search'

export type { DocumentRecord as DocumentItem } from '../../shared/api'
