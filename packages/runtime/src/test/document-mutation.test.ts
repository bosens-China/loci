import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'
import { createLocalRuntime, type LocalRuntime } from '../local-runtime.js'
import { startLocalHttpServer } from '../local-http-server.js'
import { acquireCrawlRuntimeLock } from '../runtime-lock.js'

let dir: string, runtime: LocalRuntime, lib: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'loci-doc-edit-'))
  runtime = createLocalRuntime({ dataDir: dir, cacheDir: dir })
  lib = runtime.createSource({
    ...DOCUMENT_SOURCE_DEFAULTS,
    name: 'Guide',
    url: 'https://example.test/docs'
  }).id
})
afterEach(async () => {
  await runtime.close()
  rmSync(dir, { recursive: true, force: true })
})

it('通过 HTTP 增改文档及小节，在同一提交后立即读到正文和 FTS 结果', async () => {
  const server = await startLocalHttpServer(runtime)
  try {
    const request = (path: string, method: string, body?: unknown) =>
      fetch(server.endpoint + '/api/' + path, { method, body: JSON.stringify(body) })
    const created = await request(`libraries/${lib}/documents`, 'POST', {
      title: 'Guide',
      path: '/guide/文件.md',
      content: '# Old\n\noldtoken'
    })
    expect(created.status).toBe(201)
    const { id, url } = await created.json()
    expect(url).toBe('https://example.test/guide/%E6%96%87%E4%BB%B6.md')
    const path = `documents/${id}`
    const original =
      '摘要🙂\r\n\r\n## Guide\r\n```md\r\n# sample\r\n```\r\n\r\n### End\r\nfinaltoken'
    expect(
      await (
        await request(path, 'PUT', { title: 'New title', content: original, language: 'zh' })
      ).json()
    ).toMatchObject({ id, content: original, language: 'zh' })
    const lookup = (word: string) => runtime.searchDocuments({ queries: word }).hits
    expect(lookup('oldtoken')).toEqual([])
    const sectionPath = `${path}/sections`
    const list = () => runtime.listDocumentSections(id)
    const edit = async (body: unknown) => {
      const result = await request(sectionPath, 'POST', body)
      expect(result.status).toBe(200)
      return result.json()
    }
    expect(await (await request(sectionPath, 'GET')).json()).toEqual(list())
    expect(list().map((s) => s.level)).toEqual([0, 2, 3])
    expect(
      list()
        .map((s) => original.slice(s.startOffset, s.endOffset))
        .join('')
    ).toBe(original)
    const editInput = {
      action: 'add',
      sectionId: list()[1]!.id,
      heading: 'Insert',
      level: 2,
      content: 'inserttoken',
      operationId: 'one',
      expectedUpdatedAt: list()[1]!.updatedAt
    }
    await edit(editInput)
    const inserted = list()[2]!
    expect(lookup('inserttoken')[0]?.sectionId).toBe(inserted.id)
    expect(runtime.readDocuments({ targets: id, sectionId: inserted.id })[0]?.content).toContain(
      'inserttoken'
    )
    await edit({
      action: 'update',
      sectionId: inserted.id,
      heading: 'Revised',
      level: 3,
      content: 'replacementtoken'
    })
    await edit(editInput)
    expect(lookup('inserttoken')).toEqual([])
    expect(
      (await request(sectionPath, 'POST', { ...editInput, content: 'different' })).status
    ).toBe(400)
    expect(lookup('replacementtoken')[0]?.sectionTitle).toBe('Revised')
    const remove = { action: 'delete', sectionId: inserted.id }
    await edit(remove)
    await edit(remove)
    expect(lookup('replacementtoken')).toEqual([])
    expect(list().map((s) => s.title)).toEqual(['New title', 'Guide', 'End'])
    expect(runtime.database.getDocument(id)?.content).toBe(original)
    await request(`libraries/${lib}/documents`, 'DELETE', { targets: id })
    expect((await request(sectionPath, 'GET')).status).toBe(404)
    expect(lookup('finaltoken')).toEqual([])
  } finally {
    await server.close()
  }
})

it('完整读取长文档并用版本戳保护整篇和位置小节写入', async () => {
  const body = '  long line 🙂\r\n'.repeat(2500)
  const content = `# A\r\n${body}## B\r\nsecond\r\n## C\r\nthird`
  const original = runtime.createDocument(lib, { title: 'Long', path: 'long.md', content })
  const server = await startLocalHttpServer(runtime)
  const path = `${server.endpoint}/api/documents/${original.id}`
  try {
    const detail = await (await fetch(path)).json()
    expect(detail).toMatchObject({
      id: original.id,
      sourceId: lib,
      title: 'Long',
      url: original.url,
      path: '/long.md',
      language: 'und',
      content,
      updatedAt: original.updatedAt
    })
    const sections = await (await fetch(`${path}/sections`)).json()
    expect(sections[0]).toMatchObject({ body, updatedAt: detail.updatedAt })
    const save = (method: string, route: string, input: unknown) =>
      fetch(route, { method, body: JSON.stringify(input) })
    const saved = await save('POST', `${path}/sections`, {
      action: 'update',
      sectionId: sections[0].id,
      heading: 'Renamed',
      content: sections[0].body,
      expectedUpdatedAt: detail.updatedAt
    })
    const beforeDelete = await saved.json()
    expect(beforeDelete.content).toBe(content.replace('# A', '# Renamed'))
    const script = `
      import { createLocalRuntime } from ${JSON.stringify(pathToFileURL(resolve('src/local-runtime.ts')).href)}
      const [dir, id, sectionId, expectedUpdatedAt] = process.argv.slice(1)
      const runtime = createLocalRuntime({ dataDir: dir, cacheDir: dir })
      try { runtime.editDocumentSection(id, { action: 'delete', sectionId, expectedUpdatedAt }) }
      finally { await runtime.close() }
    `
    await promisify(execFile)(process.execPath, [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      script,
      dir,
      original.id,
      sections[0].id,
      beforeDelete.updatedAt
    ])
    expect(
      (
        await save('POST', `${path}/sections`, {
          action: 'delete',
          sectionId: sections[1].id,
          expectedUpdatedAt: beforeDelete.updatedAt
        })
      ).status
    ).toBe(409)
    expect(
      (await save('PUT', path, { content: 'stale', expectedUpdatedAt: detail.updatedAt })).status
    ).toBe(409)
    expect(runtime.getDocument(original.id).content).toBe('## B\r\nsecond\r\n## C\r\nthird')
  } finally {
    await server.close()
  }
})

it.each(['github', 'openapi', 'pages'] as const)(
  '手工文档在备份恢复与 %s 全量更新后保持原文和索引',
  async (discovery) => {
    const source = runtime.createSource({
      url: discovery === 'github' ? 'https://github.com/vuejs/docs' : 'https://example.test/docs'
    })
    const record = runtime.createDocument(source.id, {
      title: 'Note',
      path: 'note.md',
      content: 'manualtoken'
    })
    await runtime.importBackupArchive(await runtime.exportBackupArchive())
    runtime.database.commitSourceCrawl(source.id, {
      documents: [
        {
          sourceId: source.id,
          title: 'Fetched',
          url: source.url + '/fetched',
          relativePath: 'note.md',
          markdown: 'shadowed',
          fetchMode: 'http',
          language: 'und',
          crawledAt: record.updatedAt
        }
      ],
      replaceAll: discovery !== 'pages',
      deletedUrls: [record.url],
      resolution: { firstUrl: source.url, mode: 'http', iconUrl: null, discovery }
    })
    expect(runtime.getDocument(record.id)).toEqual(record)
    expect(runtime.searchDocuments({ queries: 'manualtoken' }).hits.map((hit) => hit.id)).toEqual([
      record.id
    ])
  }
)

it('独立进程竞争同一个小节追加，重试后仅有一个小节和一个搜索结果', async () => {
  const { id } = runtime.createDocument(lib, {
    title: 'Guide',
    path: 'docs.md',
    content: '# Start'
  })
  const input = {
    action: 'add' as const,
    heading: 'Addition',
    content: 'uniquetoken',
    operationId: 'same-write'
  }
  const script = `
    import { createLocalRuntime } from ${JSON.stringify(pathToFileURL(resolve('src/local-runtime.ts')).href)}
    const [dir, id, input] = process.argv.slice(1)
    const runtime = createLocalRuntime({ dataDir: dir, cacheDir: dir })
    process.on('message', async () => {
      try { runtime.editDocumentSection(id, JSON.parse(input)) }
      catch (error) { if (error.name !== 'RuntimeLockedError') throw error }
      finally { await runtime.close(); process.disconnect() }
    })
    process.send('ready')
  `
  const children = Array.from({ length: 2 }, () =>
    spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script, dir, id, JSON.stringify(input)],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }
    )
  )
  const exits = children.map((child) => once(child, 'exit'))
  try {
    await Promise.all(
      children.map((child, i) =>
        Promise.race([
          once(child, 'message'),
          exits[i]!.then(() => {
            throw new Error('子进程启动失败')
          })
        ])
      )
    )
    children.forEach((child) => child.send('go'))
    expect(await Promise.all(exits)).toEqual([
      [0, null],
      [0, null]
    ])
    expect(runtime.listDocumentSections(id)).toHaveLength(2)
    runtime.editDocumentSection(id, input)
    expect(runtime.listDocumentSections(id).map((s) => s.title)).toEqual(['Start', 'Addition'])
    expect(runtime.searchDocuments({ queries: 'uniquetoken' }).hits).toHaveLength(1)
  } finally {
    children.forEach((child) => child.kill())
    await Promise.all(exits)
  }
}, 15000)

it('创建可重试，拒绝覆盖已有 URL，并在库锁与只读快照边界保护正文', () => {
  const input = { title: 'Test', url: 'https://example.test/p#intro', content: 'untouched' }
  const first = runtime.createDocument(lib, input)
  expect(runtime.createDocument(lib, input).id).toBe(first.id)
  expect(() => runtime.createDocument(lib, { ...input, content: 'changed' })).toThrow()
  const lock = acquireCrawlRuntimeLock(dir, lib, '测试抓取')
  try {
    expect(() => runtime.updateDocument(first.id, { content: 'locked' })).toThrow()
  } finally {
    lock.release()
  }
  const sqlite = new DatabaseSync(join(dir, 'loci.sqlite'))
  try {
    sqlite.prepare("UPDATE document_sources SET source_type = 'cloud' WHERE id = ?").run(lib)
  } finally {
    sqlite.close()
  }
  expect(() => runtime.updateDocument(first.id, { content: 'changed' })).toThrow('只读')
  expect(() => runtime.editDocumentSection(first.id, { action: 'add', heading: 'new' })).toThrow(
    '只读'
  )
  expect(() => runtime.createDocument(lib, { ...input, path: 'new', url: undefined })).toThrow(
    '只读'
  )
  expect(() => runtime.deleteDocuments(lib, first.id)).toThrow('只读')
  expect(runtime.readDocuments({ targets: first.id })[0]?.content).toBe('untouched')
})
