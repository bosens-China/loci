import type { CrawlFailure, CrawlProgress } from '@loci/core'

export interface LibraryInput {
  name: string
  url: string
  pageLimit: number
  schedule: string | null
}

export interface Library extends LibraryInput {
  id: string
  hostname: string
  pages: number
  lastCrawledAt: string | null
  lastError: string | null
  revision: string | null
  publishedAt: string | null
}

export interface PublicLibrary {
  id: string
  name: string
  url: string
  revision: string
  pages: number
  contentSize: number
  lastCrawledAt: string | null
  publishedAt: string
}

export interface SnapshotDocument {
  id: string
  title: string
  url: string
  language: string
  markdown: string
}

export interface LibrarySnapshot {
  schemaVersion: 1
  library: {
    id: string
    name: string
    url: string
    revision: string
    publishedAt: string
  }
  documents: SnapshotDocument[]
}

export type SyncJobStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed'

export interface SyncJob {
  id: string
  libraryId: string
  status: SyncJobStatus
  createdAt: string
  finishedAt: string | null
  progress: CrawlProgress | null
  failures: CrawlFailure[]
  error: string | null
}
