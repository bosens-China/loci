import type {
  CloudLibrary,
  CloudLibraryInput,
  CloudSyncJob,
  CloudSyncJobStatus,
  GithubBlockedState
} from '@loci/core'

export type LibraryInput = CloudLibraryInput

export interface Library extends CloudLibrary {
  githubRevision: string | null
  githubBlocked: GithubBlockedState | null
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
  relativePath?: string
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

export type SyncJobStatus = CloudSyncJobStatus
export type SyncJob = CloudSyncJob
