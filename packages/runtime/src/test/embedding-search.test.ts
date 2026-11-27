import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { EmbeddingModelId } from '@loci/shared'
import type { EmbeddingBackend } from '../embedding-assets.js'
import { EMBEDDING_MODELS, embeddingIndexKey } from '../embedding-catalog.js'
import { createLocalRuntime, type LocalRuntime } from '../local-runtime.js'
import { startLocalHttpServer } from '../local-http-server.js'

let root: string
let runtime: LocalRuntime
const installed = new Set<EmbeddingModelId>()
let failOnQuery: EmbeddingModelId | undefined
const backend: EmbeddingBackend = {
  isInstalled: ({ id }) => installed.has(id),
  install: async ({ id }) => {
    installed.add(id)
  },
  open: async ({ id, dimensions }) => ({
    countTokens: (text) => text.length + 2,
    embed: async (texts) =>
      texts.map((text) => {
        if (id === failOnQuery && text === 'router') throw new Error('模型推理失败')
        const vector = new Float32Array(dimensions)
        vector[text.includes('morecontext') ? 1 : 0] = 1
        return vector
      }),
    close: async () => undefined
  })
}

beforeEach(() => {
  installed.clear()
  failOnQuery = undefined
  root = mkdtempSync(join(tmpdir(), 'loci-embedding-search-'))
  runtime = createLocalRuntime({
    dataDir: root,
    cacheDir: root,
    embeddingBackend: backend,
    launchEmbeddingRefresh: () => undefined
  })
})
afterEach(async () => {
  await runtime.close()
  rmSync(root, { recursive: true, force: true })
})

it('三路定位采用小节去重，保留同文档的第二小节和完整 Markdown', async () => {
  const library = runtime.createSource({ url: 'https://vue.test', version: 'v3' })
  const unrelated = runtime.createSource({ url: 'https://other.test' })
  const primary = `# Start\n\nrouter conditions\n\n${'Detailed explanation. '.repeat(30).trim()}`
  const secondary = '## Details\n\nmorecontext with source'
  const doc = runtime.createDocument(library.id, {
    title: 'Navigation',
    path: '/routing/guard.md',
    language: 'und',
    content: primary + '\n\n' + secondary
  })
  runtime.createDocument(unrelated.id, {
    title: 'Outside',
    path: '/outside.md',
    content: '# Other\n\nrouter'
  })
  const input = {
    queries: 'router',
    libraryIds: [library.id],
    pathPrefix: '/routing',
    includeContent: true
  }

  const keyword = await runtime.searchDocumentSections(input)
  expect(keyword.hits).toMatchObject([{ sectionTitle: 'Start', content: primary }])

  runtime.embeddings.start('minilm')
  expect(await runtime.embeddings.wait('minilm')).toMatchObject({ indexed: 2, total: 2 })
  expect((await runtime.searchDocumentSections(input)).hits[0].matchesFrom).toEqual([
    'keyword',
    'minilm'
  ])
  runtime.embeddings.start('bge-m3')
  expect(await runtime.embeddings.wait('bge-m3')).toMatchObject({ indexed: 2, total: 2 })
  const key = embeddingIndexKey(EMBEDDING_MODELS['bge-m3'])
  const whole = runtime.database.listEmbeddingBatch(key, '', [library.id])[0]
  expect(whole.chunks).toMatchObject([
    { startOffset: 0, endOffset: (primary + '\n\n' + secondary).length }
  ])

  const server = await startLocalHttpServer(runtime)
  try {
    const response = await fetch(`${server.endpoint}/api/search`, {
      method: 'POST',
      body: JSON.stringify({ ...input, limit: 1 })
    })
    expect(response.ok).toBe(true)
    const first = await response.json()
    expect(first).toMatchObject({
      total: 2,
      nextOffset: 1,
      hits: [
        {
          id: doc.id,
          url: doc.url,
          libraryVersion: 'v3',
          headingPath: ['Start'],
          language: 'und',
          sectionTitle: 'Start',
          content: primary,
          matchesFrom: ['keyword', 'minilm', 'bge-m3']
        }
      ]
    })
    const second = await runtime.searchDocumentSections({
      ...input,
      offset: 1,
      limit: 1,
      pageToken: first.nextPageToken
    })
    expect(second.hits).toMatchObject([
      { id: doc.id, sectionTitle: 'Details', headingPath: ['Start', 'Details'], content: secondary }
    ])
    expect(
      runtime.readDocuments({ targets: doc.id, sectionId: second.hits[0].sectionId })[0].content
    ).toBe(secondary)
    const tree = await runtime.getSearchLibraryTree(library.id, { depth: 3, queries: 'router' })
    expect(tree[0].children?.[0].sectionIds).toEqual([
      first.hits[0].sectionId,
      second.hits[0].sectionId
    ])
  } finally {
    await server.close()
  }

  failOnQuery = 'bge-m3'
  expect((await runtime.searchDocumentSections(input)).hits[0].matchesFrom).toEqual([
    'keyword',
    'minilm'
  ])
  failOnQuery = undefined

  const before = runtime.getDocument(doc.id)
  runtime.updateDocument(doc.id, { content: '# Replaced\n\nupdated passages' })
  const old = { id: before.id, title: before.title, markdown: before.content }
  expect(
    runtime.database.storeDocumentEmbeddings(
      embeddingIndexKey(EMBEDDING_MODELS.minilm),
      old,
      [],
      Buffer.alloc(384 * 4)
    )
  ).toBe(false)
  expect((await runtime.searchDocumentSections(input)).hits).toEqual([])
  runtime.embeddings.start('minilm')
  await runtime.embeddings.wait('minilm')
  expect((await runtime.searchDocumentSections(input)).hits).toMatchObject([
    {
      sectionTitle: 'Replaced',
      content: '# Replaced\n\nupdated passages',
      matchesFrom: ['minilm']
    }
  ])
})

it('后台索引改变命中顺序时，HTTP 续页返回冲突并可从第一页重新查询', async () => {
  const library = runtime.createSource({ url: 'https://pagination.test' })
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    runtime.createDocument(library.id, {
      title: name,
      path: '/' + name,
      content: '# ' + name + '\n\nrouter'
    })
  }
  runtime.createDocument(library.id, {
    title: 'Semantic',
    path: '/semantic',
    content: '# Semantic\n\nnavigation'
  })
  const server = await startLocalHttpServer(runtime)
  try {
    const search = (page: { offset?: number; pageToken?: string } = {}) =>
      fetch(server.endpoint + '/api/search', {
        method: 'POST',
        body: JSON.stringify({ queries: 'router', limit: 2, ...page })
      })
    const first = await (await search()).json()
    expect(first.hits.map((hit: { title: string }) => hit.title)).toEqual(['Alpha', 'Beta'])
    expect(first.nextPageToken).toEqual(expect.any(String))

    const legacyDocument = runtime.database.nextUnindexedDocument(EMBEDDING_MODELS.minilm.key, '')!
    runtime.database.storeDocumentEmbeddings(
      EMBEDDING_MODELS.minilm.key,
      legacyDocument,
      [],
      Buffer.alloc(0)
    )
    installed.add('minilm')
    expect(runtime.embeddings.getStatus('minilm')).toMatchObject({ installed: true, indexed: 0 })
    runtime.embeddings.start('minilm')
    await runtime.embeddings.wait('minilm')

    const changed = await search({ offset: first.nextOffset, pageToken: first.nextPageToken })
    expect(changed.status).toBe(409)
    const fresh = await (await search()).json()
    const next = await search({ offset: fresh.nextOffset, pageToken: fresh.nextPageToken })
    expect(next.ok).toBe(true)
    const hits = [...fresh.hits, ...(await next.json()).hits]
    expect(new Set(hits.map((hit: { id: string }) => hit.id)).size).toBe(4)
  } finally {
    await server.close()
  }
})

it('不同进程复用同一次模型安装，支持跨进程取消和重试', async () => {
  const script = `
    import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
    import { join } from 'node:path'
    import { setTimeout as delay } from 'node:timers/promises'
    import { createLocalRuntime } from ${JSON.stringify(pathToFileURL(resolve('src/local-runtime.ts')).href)}
    const [dataDir] = process.argv.slice(1)
    const marker = join(dataDir, 'test-ready')
    const allow = join(dataDir, 'finish-download')
    const runtime = createLocalRuntime({ dataDir, cacheDir: dataDir, embeddingBackend: {
      isInstalled: () => existsSync(marker),
      install: async (_model, signal) => {
        appendFileSync(join(dataDir, 'attempts'), 'download\\n')
        while (!existsSync(allow)) await delay(25, undefined, { signal })
        writeFileSync(marker, '')
      },
      open: async () => ({
        countTokens: (text) => text.length + 2,
        embed: async () => [], close: async () => undefined
      })
    } })
    try {
      runtime.embeddings.start('minilm')
      appendFileSync(join(dataDir, 'started'), 'start\\n')
      console.log(JSON.stringify(await runtime.embeddings.wait('minilm')))
    } finally { await runtime.close() }
  `
  const child = () =>
    promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script, root],
      { timeout: 14_000 }
    )
  const first = child()
  await expect
    .poll(() => runtime.embeddings.getStatus('minilm').operation?.phase, {
      timeout: 8000,
      interval: 25
    })
    .toBe('downloading')
  runtime.embeddings.cancel('minilm')
  expect(JSON.parse((await first).stdout)).toMatchObject({ operation: { phase: 'cancelled' } })

  const attempts = [child(), child()]
  await expect
    .poll(() => readFileSync(join(root, 'started'), 'utf8').trim().split('\n').length, {
      timeout: 8000
    })
    .toBe(3)
  writeFileSync(join(root, 'finish-download'), '')
  const retried = await Promise.all(attempts)
  for (const { stdout } of retried)
    expect(JSON.parse(stdout)).toMatchObject({ installed: true, indexed: 0, total: 0 })
  expect(readFileSync(join(root, 'attempts'), 'utf8')).toBe('download\ndownload\n')
}, 22_000)
