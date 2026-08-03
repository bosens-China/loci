import { describe, expect, it } from 'vitest'
import type { CloudSyncJob } from '@loci/shared'
import { getCloudSyncPercent, isCloudSyncJobActive } from '../cloud-sync-progress'

describe('CloudSyncProgress', () => {
  it('计算动态队列进度并识别终态', () => {
    const job: CloudSyncJob = {
      id: 'job-1',
      libraryId: 'library-1',
      status: 'running',
      createdAt: '2026-08-03T00:00:00.000Z',
      finishedAt: null,
      progress: { queued: 3, processed: 1, succeeded: 1, failed: 0, limitReached: false },
      failures: [],
      error: null
    }
    expect(isCloudSyncJobActive(job)).toBe(true)
    expect(getCloudSyncPercent(job)).toBe(25)
    expect(getCloudSyncPercent({ ...job, status: 'completed' })).toBe(100)
  })
})
