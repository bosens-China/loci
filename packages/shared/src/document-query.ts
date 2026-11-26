import type { DocumentRecord, DocumentSource, DocumentSummary } from './api.js'
import type { UrlTreeNode } from './url-tree.js'

export interface DocumentDetail extends DocumentRecord {
  path: string
}

export interface DocumentSectionSummary {
  id: string
  title: string
  level: number
  startOffset: number
  endOffset: number
  charCount: number
  body: string
}

export interface CreateDocumentInput {
  title: string
  path?: string
  url?: string
  content: string
  language?: string
}

export interface DocumentSectionDetail extends DocumentSectionSummary {
  updatedAt: string
}

export interface UpdateDocumentInput {
  expectedUpdatedAt?: string
  title?: string
  content?: string
  language?: string
}

export interface EditDocumentSectionInput {
  expectedUpdatedAt?: string
  action: 'add' | 'update' | 'delete'
  sectionId?: string
  heading?: string
  level?: number
  content?: string
  /** 对同一次变更的网络重试应复用此值。 */
  operationId?: string
}

export interface LibrarySummary extends DocumentSource {
  pageCount: number
  languages: string[]
}

export interface SearchPassage {
  sectionId: string
  sectionTitle: string
  paragraph: string
  truncated: boolean
}

export interface LibraryTreeOptions {
  parent?: string
  depth?: number
  queries?: string | readonly string[]
}

export interface DocumentSearchInput {
  queries: string | readonly string[]
  libraryIds?: readonly string[]
  pathPrefix?: string
  offset?: number
  limit?: number
  tree?: boolean
}

export interface DocumentSearchHit extends DocumentSummary, SearchPassage {
  path: string
}

export interface DocumentSearchResult {
  hits: DocumentSearchHit[]
  total: number
  nextOffset?: number
  retrieval: Array<{ query: string; mode: 'all' | 'any' | 'fuzzy' }>
  trees?: Array<{ libraryId: string; nodes: UrlTreeNode[] }>
}

export interface DocumentReadInput {
  libraryId?: string
  targets: string | readonly string[]
  sectionId?: string
  offset?: number
  maxCharsPerFile?: number
}

export interface DocumentReadResult extends DocumentSummary {
  path: string
  content: string
  offset: number
  nextOffset?: number
  totalChars: number
  truncated: boolean
  sectionId?: string
}
