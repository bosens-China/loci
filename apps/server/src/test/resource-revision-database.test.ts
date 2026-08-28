import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ServerDatabase } from '../database.js'

describe('Server 资源 revision', () => {
  it('通过触发器向另一数据库连接公开文档库与抓取策略变化', () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-server-resource-revisions-'))
    const filename = join(root, 'server.sqlite')
    const reader = new ServerDatabase(filename)
    const writer = new ServerDatabase(filename)
    try {
      const initial = reader.resourceRevisions.get()
      writer.createLibrary({
        name: 'Vite',
        url: 'https://vite.dev',
        scopePath: '/',
        pageLimit: 10,
        schedule: null
      })
      expect(reader.resourceRevisions.get().libraries).toBeGreaterThan(initial.libraries)

      writer.crawlSettings.save({
        ...writer.crawlSettings.get(),
        maxConcurrentJobs: 3
      })
      expect(reader.resourceRevisions.get().crawlSettings).toBeGreaterThan(initial.crawlSettings)
    } finally {
      writer.close()
      reader.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
