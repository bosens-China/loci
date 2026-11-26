import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'
import { createLocalRuntime, type LocalRuntime } from '../local-runtime.js'
import { startLocalHttpServer } from '../local-http-server.js'

let root: string
let runtime: LocalRuntime
let libraryId: string
let otherId: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'loci-document-query-'))
  runtime = createLocalRuntime({ dataDir: root, cacheDir: root })
  libraryId = runtime.createSource({
    ...DOCUMENT_SOURCE_DEFAULTS,
    name: 'Guide',
    url: 'https://docs.test'
  }).id
  otherId = runtime.createSource({
    ...DOCUMENT_SOURCE_DEFAULTS,
    name: 'Second',
    url: 'https://other.test'
  }).id
  for (const [sourceId, path, title, markdown] of [
    [
      libraryId,
      'guide/routing/setup.md',
      'Zebra',
      '# Intro\n\nIntro.\n\n## Start\n\nrouter setup and details'
    ],
    [libraryId, 'guide/routing/api.md', 'Alpha', '# API\n\nrouter definition'],
    [libraryId, 'guide/routing/other.md', 'Middle', '# Other\n\nbasic'],
    [libraryId, 'guide/routing-more/file.md', 'Suffix', '# More\n\nrouter setup'],
    [otherId, 'guide/routing/setup.md', 'External', '# External\n\nrouter exclusive']
  ])
    runtime.database.saveDocument({
      sourceId,
      relativePath: path,
      url: `https://example.test/api#${title}`,
      title,
      markdown,
      fetchMode: 'http',
      language: 'en',
      crawledAt: '2026-08-02T00:00:00.000Z'
    })
})
afterEach(async () => {
  await runtime.close()
  rmSync(root, { recursive: true, force: true })
})

describe('跨入口文档查询与读取', () => {
  it('在指定库和逻辑路径内回退检索，分页只影响命中列表，裁剪后的树保留段落与计数', () => {
    const result = runtime.searchDocuments({
      queries: ['router exclusive', 'lph'],
      libraryIds: [libraryId],
      pathPrefix: '/guide/routing',
      tree: true,
      limit: 1
    })
    expect(result).toMatchObject({
      total: 2,
      nextOffset: 1,
      retrieval: [{ mode: 'any' }, { mode: 'fuzzy' }],
      trees: [
        {
          libraryId,
          nodes: [
            {
              title: 'guide',
              matchedCount: 2,
              totalCount: 4,
              children: [{ title: 'routing', matchedCount: 2, totalCount: 3 }]
            }
          ]
        }
      ]
    })
    expect(result.hits).toHaveLength(1)
    const leaves = runtime.getLibraryTree(libraryId, {
      parent: '/guide/routing',
      depth: 1,
      queries: ['router']
    })
    expect(leaves.map((n) => n.title)).toEqual(['Alpha', 'Zebra'])
    const item = leaves[1]!
    expect(item).toMatchObject({
      language: 'en',
      sectionTitle: 'Start',
      paragraph: 'router setup and details',
      readable: true
    })
    const request = {
      libraryId,
      targets: item.id.slice(0, 8),
      sectionId: item.sectionId,
      maxCharsPerFile: 10
    }
    const first = runtime.readDocuments(request)[0]!
    const second = runtime.readDocuments({
      ...request,
      offset: first.nextOffset,
      maxCharsPerFile: 100
    })[0]!
    expect(first.content + second.content).toBe('## Start\n\nrouter setup and details')
    expect(runtime.listLibraries('GUIDE')).toMatchObject([
      { id: libraryId, languages: ['en'], pageCount: 4 }
    ])
  })

  it('重叠子树与 ID 以树顺序去重，删除同时清理 FTS 并支持重试', () => {
    const [alpha] = runtime.readDocuments({ libraryId, targets: '/guide/routing/api.md' })
    const targets = [alpha!.id, '/guide/routing/setup.md', '/guide/routing']
    expect(runtime.readDocuments({ libraryId, targets }).map((d) => d.title)).toEqual([
      'Alpha',
      'Middle',
      'Zebra'
    ])
    expect(runtime.deleteDocuments(libraryId, targets)).toEqual({ deleted: 3 })
    expect(runtime.deleteDocuments(libraryId, targets)).toEqual({ deleted: 0 })
    expect(
      runtime
        .searchDocuments({ libraryIds: [libraryId], queries: 'router' })
        .hits.map((d) => d.title)
    ).toEqual(['Suffix'])
    expect(runtime.readDocuments({ libraryId: otherId, targets: '/' })).toHaveLength(1)
    runtime.deleteLibrary(libraryId)
    expect(runtime.listLibraries().map((s) => s.id)).toEqual([otherId])
  })

  it('Web 查询和读取得到相同的契约，拒绝跨源删除', async () => {
    const server = await startLocalHttpServer(runtime)
    try {
      const post = (path: string, body: unknown) =>
        fetch(server.endpoint + path, {
          method: 'POST',
          headers: { origin: server.endpoint },
          body: JSON.stringify(body)
        })
      const input = { queries: ['router'], libraryIds: [libraryId], tree: true }
      expect(await (await post('/api/search', input)).json()).toEqual(
        runtime.searchDocuments(input)
      )
      const read = {
        libraryId,
        targets: ['/guide/routing', '/guide/routing/setup.md'],
        maxCharsPerFile: 8
      }
      expect(await (await post('/api/read', read)).json()).toEqual(runtime.readDocuments(read))
      expect(
        await (
          await fetch(
            `${server.endpoint}/api/libraries/${libraryId}/tree?queries=router&parent=/guide/routing`
          )
        ).json()
      ).toEqual(runtime.getLibraryTree(libraryId, { parent: '/guide/routing', queries: 'router' }))
      const denied = await fetch(`${server.endpoint}/api/libraries/${libraryId}`, {
        method: 'DELETE',
        headers: { origin: 'https://other.test' }
      })
      expect(denied.status).toBe(403)
      expect(runtime.listLibraries('guide')[0]?.pageCount).toBe(4)
    } finally {
      await server.close()
    }
  })
})
