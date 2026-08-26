import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

describe('资源 revision', () => {
  it('通过触发器观察另一数据库连接的来源、文档、任务和设置写入', () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-resource-revisions-'))
    const filename = join(root, 'loci.sqlite')
    const reader = createDatabase(filename)
    const writer = createDatabase(filename)
    try {
      const initial = reader.getResourceRevisions()
      const source = writer.createSource({
        name: 'Vite',
        url: 'https://vite.dev',
        mode: 'http',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      const afterSource = reader.getResourceRevisions()
      expect(afterSource.sources).toBeGreaterThan(initial.sources)
      expect(afterSource.documents).toBe(initial.documents)

      writer.saveDocument({
        sourceId: source.id,
        url: 'https://vite.dev/guide',
        title: 'Guide',
        markdown: '# Guide',
        language: 'en',
        fetchMode: 'http',
        crawledAt: '2026-08-26T00:00:00.000Z'
      })
      const afterDocument = reader.getResourceRevisions()
      expect(afterDocument.sources).toBeGreaterThan(afterSource.sources)
      expect(afterDocument.documents).toBeGreaterThan(afterSource.documents)

      writer.enqueueSourceSync(source.id, 'mcp')
      expect(reader.getResourceRevisions().jobs).toBeGreaterThan(initial.jobs)

      writer.saveSettings({ ...writer.getSettings(), theme: 'dark' })
      expect(reader.getResourceRevisions().settings).toBeGreaterThan(initial.settings)
    } finally {
      writer.close()
      reader.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
