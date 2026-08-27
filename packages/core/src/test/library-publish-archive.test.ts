import { describe, expect, it } from 'vitest'
import {
  createLibraryPublishArchive,
  parseLibraryPublishArchive
} from '../library-publish-archive.js'

describe('library publish archive', () => {
  it('round trips a checksummed binary library payload', async () => {
    const archive = await createLibraryPublishArchive({
      mode: 'create',
      targetLibraryId: null,
      source: {
        name: 'Docs',
        url: 'https://docs.example.com/start',
        scopePath: '/',
        pageLimit: 100
      },
      documents: [
        {
          id: 'doc-1',
          title: 'Start',
          url: 'https://docs.example.com/start',
          language: 'en',
          markdown: '# Start',
          crawledAt: '2026-08-27T00:00:00.000Z',
          relativePath: '/start'
        }
      ]
    })
    const parsed = await parseLibraryPublishArchive(archive)

    expect(archive.subarray(0, 2).toString()).toBe('PK')
    expect(parsed).toMatchObject({
      mode: 'create',
      source: { name: 'Docs' },
      documents: [{ markdown: '# Start' }]
    })
    expect(parsed.publishId).toMatch(/^[a-f0-9]{64}$/u)
  })
})
