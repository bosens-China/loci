import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudLibraryService } from '../cloud-library-service.js'
import { createDatabase, type LociDatabase } from '../database.js'
import { acquireMaintenanceRuntimeLock } from '../runtime-lock.js'

describe('CloudLibraryService', () => {
  let database: LociDatabase | undefined
  const directories: string[] = []

  afterEach(() => {
    database?.close()
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true })
  })

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

    const catalogItem = (await service.listCatalog('HTTP://LOCALHOST:7001/'))[0]
    expect(catalogItem?.localSourceId).toBeNull()
    const imported = await service.importLibrary('http://localhost:7001', 'library-1', true)
    expect(imported).toMatchObject({ updated: true, documents: 1 })
    expect(imported.source.contentSize).toBe(catalogItem?.contentSize)
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

  it('把连接失败和旧版响应转换为可读错误', async () => {
    database = createDatabase(':memory:')
    const offline = new CloudLibraryService(database, async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(offline.listCatalog('http://localhost:7001')).rejects.toThrow(
      '无法连接云端后端，请检查地址和网络'
    )

    const incompatible = new CloudLibraryService(database, async () =>
      jsonResponse({ libraries: [{ ...library('sha256:v1'), contentSize: undefined }] })
    )
    await expect(incompatible.listCatalog('http://localhost:7001')).rejects.toThrow(
      '云端后端版本不兼容，请更新后端服务'
    )
  })

  it('忽略云端空文档库，并拒绝用空快照覆盖本地可用副本', async () => {
    database = createDatabase(':memory:')
    let emptySnapshot = false
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/libraries')) {
        return jsonResponse({
          libraries: [library('sha256:v1'), { ...library('sha256:empty'), id: 'empty', pages: 0 }]
        })
      }
      return jsonResponse(
        emptySnapshot ? { ...snapshot('sha256:v2'), documents: [] } : snapshot('sha256:v1')
      )
    })
    const service = new CloudLibraryService(database, fetcher)

    expect((await service.listCatalog('http://localhost:7001')).map((item) => item.id)).toEqual([
      'library-1'
    ])
    const imported = await service.importLibrary('http://localhost:7001', 'library-1', false)
    expect(imported.documents).toBe(1)

    emptySnapshot = true
    await expect(
      service.updateLibrary(imported.source.id, 'http://localhost:7001')
    ).rejects.toThrow('没有可用文档')
    expect(database.searchDocuments('version-v1')).toHaveLength(1)
    expect(database.listSources().find((item) => item.id === imported.source.id)?.pages).toBe(1)
  })

  it('同一云文档的重复导入复用一次下载', async () => {
    database = createDatabase(':memory:')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetcher = vi.fn<typeof fetch>(async () => {
      await gate
      return jsonResponse(snapshot('sha256:v1'))
    })
    const service = new CloudLibraryService(database, fetcher)

    const first = service.importLibrary('http://localhost:7001', 'library-1', false)
    const duplicate = service.importLibrary('http://localhost:7001', 'library-1', false)
    release()
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate])

    expect(fetcher).toHaveBeenCalledOnce()
    expect(duplicateResult.source.id).toBe(firstResult.source.id)
  })

  it('数据维护期间拒绝云端快照写入', async () => {
    database = createDatabase(':memory:')
    const dataDir = mkdtempSync(join(tmpdir(), 'loci-cloud-lock-'))
    directories.push(dataDir)
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(snapshot('sha256:v1')))
    const service = new CloudLibraryService(database, fetcher, dataDir)
    const maintenance = acquireMaintenanceRuntimeLock(dataDir, '备份导入')

    await expect(
      service.importLibrary('http://localhost:7001', 'library-1', false)
    ).rejects.toThrow('数据库正在由备份导入维护')
    expect(fetcher).not.toHaveBeenCalled()
    maintenance.release()
  })
})

function library(revision: string): Record<string, unknown> {
  return {
    id: 'library-1',
    name: 'Cloud Docs',
    url: 'https://docs.example.com',
    revision,
    pages: 1,
    contentSize: Buffer.byteLength(`version-${revision.split(':').at(-1)}`),
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
