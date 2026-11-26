import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createLocalRuntime } from '../local-runtime.js'

it('从旧备份恢复审查库后只刷新已有 URL，并区分 404 和临时失败', async () => {
  const visited: string[] = []
  const server = createServer((request, response) => {
    visited.push(request.url ?? '')
    if (request.url === '/approved') {
      response.end('<main><h1>Guide</h1><p>refreshed</p><a href="/new">New</a></main>')
    } else {
      response.writeHead(request.url === '/temporary' ? 503 : 404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试监听失败')
  const origin = `http://127.0.0.1:${address.port}`
  const dir = mkdtempSync(join(tmpdir(), 'loci-reviewed-'))
  const runtime = createLocalRuntime({ dataDir: dir, cacheDir: dir })
  try {
    const source = runtime.createSource({ url: origin, mode: 'http' })
    runtime.patchAppSettings({ maxRetries: 0 })
    for (const path of ['approved', 'missing', 'temporary']) {
      runtime.database.saveDocument({
        sourceId: source.id,
        url: `${origin}/${path}`,
        title: path,
        markdown: 'oldcontent',
        language: 'en',
        fetchMode: 'http',
        crawledAt: new Date().toISOString()
      })
    }
    const backup = runtime.database.exportBackup({ libraryIds: [source.id] })
    backup.data.sources[0]!.discovery_mode = 'agent_review'
    runtime.database.importBackup(backup)

    await expect(runtime.crawlSource(source.id)).resolves.toMatchObject({ succeeded: 1, failed: 2 })
    expect([...visited].sort()).toEqual(['/approved', '/missing', '/temporary'])
    expect(runtime.database.listDocumentUrls(source.id).sort()).toEqual([
      origin + '/approved',
      origin + '/temporary'
    ])
    expect(runtime.searchDocuments({ queries: 'refreshed' }).hits).toMatchObject([
      { url: origin + '/approved' }
    ])
    expect(runtime.searchDocuments({ queries: 'oldcontent' }).hits).toMatchObject([
      { url: origin + '/temporary' }
    ])

    await expect(runtime.clearData('documents')).resolves.toMatchObject({ documents: 2 })
    visited.length = 0
    await expect(runtime.crawlSource(source.id)).resolves.toMatchObject({ succeeded: 1, failed: 1 })
    expect([...visited].sort()).toEqual(['/approved', '/temporary'])
    expect(runtime.searchDocuments({ queries: 'refreshed' }).hits).toMatchObject([
      { url: origin + '/approved' }
    ])
  } finally {
    await runtime.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})
