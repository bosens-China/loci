import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudLibraryService } from '../cloud-library-service'
import { createDatabase, type LociDatabase } from '../database'

describe('CloudLibraryService', () => {
  let database: LociDatabase | undefined

  afterEach(() => database?.close())

  it('事务导入快照，并只更新当前后端的同源副本', async () => {
    database = createDatabase(':memory:')
    let revision = 'sha256:v1'
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/libraries')) {
        return jsonResponse({ libraries: [library(revision)] })
      }
      const etag = new Headers(init?.headers).get('If-None-Match')
      if (etag === `"${revision}"`) return new Response(null, { status: 304 })
      return jsonResponse(snapshot(revision))
    })
    const service = new CloudLibraryService(database, fetcher)

    expect((await service.listCatalog('HTTP://LOCALHOST:7001/'))[0]?.localSourceId).toBeNull()
    const imported = await service.importLibrary('http://localhost:7001', 'library-1', true)
    expect(imported).toMatchObject({ updated: true, documents: 1 })
    expect(imported.source.cloud).toMatchObject({
      serverUrl: 'http://localhost:7001',
      revision: 'sha256:v1',
      autoSync: true
    })
    expect(database.searchDocuments('version-v1')[0]?.title).toBe('Document sha256:v1')

    revision = 'sha256:v2'
    expect((await service.listCatalog('http://localhost:7001'))[0]?.updateAvailable).toBe(true)
    await expect(
      service.updateLibrary(imported.source.id, 'https://other.example.com')
    ).rejects.toThrow('来自其他后端')

    const updated = await service.updateLibrary(imported.source.id, 'http://localhost:7001')
    expect(updated).toMatchObject({ updated: true, documents: 1 })
    expect(database.searchDocuments('version-v1')).toEqual([])
    expect(database.searchDocuments('version-v2')[0]?.title).toBe('Document sha256:v2')
    expect(database.listCloudSourcesForSync('http://localhost:7001')).toHaveLength(1)
    expect(database.listCloudSourcesForSync('https://other.example.com')).toEqual([])

    revision = 'sha256:v3'
    await service.syncEligible('https://other.example.com')
    expect(database.searchDocuments('version-v2')).toHaveLength(1)
    await service.syncEligible('http://localhost:7001')
    expect(database.searchDocuments('version-v3')).toHaveLength(1)
  })
})

function library(revision: string): Record<string, unknown> {
  return {
    id: 'library-1',
    name: 'Cloud Docs',
    url: 'https://docs.example.com',
    revision,
    pages: 1,
    snapshotSize: 256,
    lastCrawledAt: '2026-08-03T00:00:00.000Z',
    publishedAt: '2026-08-03T00:00:00.000Z'
  }
}

function snapshot(revision: string): Record<string, unknown> {
  const version = revision.split(':').at(-1)
  return {
    schemaVersion: 1,
    library: {
      id: 'library-1',
      name: 'Cloud Docs',
      url: 'https://docs.example.com',
      revision,
      publishedAt: '2026-08-03T00:00:00.000Z'
    },
    documents: [
      {
        id: `document-${revision}`,
        title: `Document ${revision}`,
        url: `https://docs.example.com/${revision.replace(':', '-')}`,
        language: 'en',
        markdown: `version-${version}`
      }
    ]
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
