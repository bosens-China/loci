import { describe, expect, it } from 'vitest'
import type { CloudSyncJob } from '@loci/shared'
import { latestJobsByLibrary } from '../useCloudSyncJobs'

function job(libraryId: string, createdAt: string): CloudSyncJob {
  return {
    id: `${libraryId}-${createdAt}`,
    libraryId,
    status: 'completed',
    createdAt,
    finishedAt: createdAt,
    progress: null,
    failures: [],
    error: null
  }
}

describe('云端同步任务归并', () => {
  it('每个文档库保留最新任务', () => {
    const result = latestJobsByLibrary([
      job('a', '2026-08-01T00:00:00.000Z'),
      job('b', '2026-08-02T00:00:00.000Z'),
      job('a', '2026-08-03T00:00:00.000Z')
    ])
    expect(result.a?.createdAt).toBe('2026-08-03T00:00:00.000Z')
    expect(result.b?.createdAt).toBe('2026-08-02T00:00:00.000Z')
  })
})
