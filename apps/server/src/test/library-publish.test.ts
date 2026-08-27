import { describe, expect, it } from 'vitest'
import { createLibraryPublishArchive, parseLibraryPublishArchive } from '@loci/core'
import { ServerDatabase } from '../database.js'

describe('管理员二进制发布', () => {
  it('事务发布并按稳定 publish ID 幂等复用', async () => {
    const database = new ServerDatabase(':memory:')
    try {
      const payload = await parseLibraryPublishArchive(
        await createLibraryPublishArchive({
          mode: 'create',
          targetLibraryId: null,
          source: {
            name: 'Published Docs',
            url: 'https://publish.example.com/docs',
            scopePath: '/docs',
            pageLimit: 50
          },
          documents: [
            {
              id: 'local-doc',
              title: 'Guide',
              url: 'https://publish.example.com/docs/guide',
              language: 'en',
              markdown: '# Guide',
              crawledAt: '2026-08-27T00:00:00.000Z',
              relativePath: '/docs/guide'
            }
          ]
        })
      )
      const first = database.publishImportedLibrary(payload)
      const repeated = database.publishImportedLibrary(payload)

      expect(first.reused).toBe(false)
      expect(repeated).toMatchObject({
        reused: true,
        library: { id: first.library.id },
        snapshot: { documents: [{ markdown: '# Guide' }] }
      })
      expect(database.listPublishedLibraries()).toHaveLength(1)
    } finally {
      database.close()
    }
  })
})
