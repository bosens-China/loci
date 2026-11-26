import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'
import { expect, it } from 'vitest'
import { createBackupArchive, parseBackupArchive } from '../database-backup-archive.js'
import { createDatabase, type LociDatabase } from '../database.js'

function add(db: LociDatabase, version: string, category: string, word: string) {
  const source = db.createSource({
    ...DOCUMENT_SOURCE_DEFAULTS,
    name: 'Docs',
    url: 'https://docs.test',
    version,
    category
  })
  const url = `https://docs.test/${word}`
  db.saveDocument({
    sourceId: source.id,
    url,
    title: word,
    markdown: word,
    language: 'en',
    fetchMode: 'http',
    crawledAt: new Date().toISOString()
  })
  db.registerExplicitPageTargets(source.id, [url])
  db.startCrawlRun(source.id)
  return source.id
}

it('旧版只读快照按远端身份更新，保留同源可写库及索引', async () => {
  const db = createDatabase(':memory:')
  try {
    const local = add(db, 'latest', '团队', 'localnote')
    const backup = db.exportBackup({ libraryIds: [local] })
    const source = backup.data.sources[0]!
    const restore = async (id: string, sourceIdentity: string | null) => {
      backup.data.sources = [
        {
          ...source,
          id,
          source_type: 'cloud',
          cloud_server_url: 'https://archive.test',
          cloud_library_id: 'old-library',
          cloud_revision: id,
          source_identity: sourceIdentity
        }
      ]
      backup.data.documents = []
      backup.data.explicitPageTargets = []
      backup.data.crawlRuns = []
      return db.importBackupArchive(await createBackupArchive(backup, 18))
    }
    expect(await restore('first-snapshot', null)).toMatchObject({ replacedLibraries: 0 })
    expect(await restore('new-snapshot', source.source_identity ?? null)).toMatchObject({
      replacedLibraries: 1
    })
    expect(db.hasSource('first-snapshot')).toBe(false)
    expect(db.getSource('new-snapshot').readOnly).toBe(true)
    expect(db.searchDocuments('localnote')).toMatchObject([{ sourceId: local }])
    expect(db.listSources()).toHaveLength(2)
  } finally {
    db.close()
  }
})

it('分类 ZIP 在匹配版本上完整覆盖文档、索引、页面目标和抓取记录，保留其他版本与全局设置', async () => {
  const source = createDatabase(':memory:')
  const local = createDatabase(':memory:')
  try {
    const incoming = add(source, 'latest', '团队', 'incoming')
    const excluded = add(source, 'v18', '另一分类', 'excluded')
    const stale = add(local, 'latest', '旧分类', 'stale')
    const keep = add(local, 'v18', '另一分类', 'retained')
    local.patchAppSettings({ theme: 'dark' })
    const bytes = await source.exportBackupArchive({ categories: ['团队'] })
    const { backup } = await parseBackupArchive(bytes)
    expect(backup.scope).toBe('filtered')
    expect(backup.data.categories?.map((c) => c.name)).toEqual(['团队'])
    expect(backup.data.settings).toBeUndefined()
    expect(backup.data.hostnameCrawlPolicies).toBeUndefined()
    expect(backup.data.sources.map((s) => s.id)).toEqual([incoming])
    expect(backup.data.documents.map((d) => d.source_id)).toEqual([incoming])
    expect(backup.data.crawlRuns.map((r) => r.source_id)).toEqual([incoming])
    expect(backup.data.explicitPageTargets?.map((t) => t.source_id)).toEqual([incoming])
    expect(
      source.exportBackup({ categories: ['团队'], libraryIds: [excluded] }).data.sources
    ).toHaveLength(2)
    for (const created of [1, 0]) {
      expect(await local.importBackupArchive(bytes)).toMatchObject({
        mode: 'merge',
        importedLibraries: 1,
        replacedLibraries: 1,
        importedDocuments: 1,
        categoriesCreated: created
      })
      expect(local.hasSource(stale)).toBe(false)
      expect(local.listSources()).toHaveLength(2)
      expect(local.searchDocuments('stale')).toHaveLength(0)
      expect(local.searchDocuments('incoming')).toMatchObject([{ sourceId: incoming }])
      expect(local.searchDocuments('retained')).toMatchObject([{ sourceId: keep }])
      expect(local.listExplicitPageTargets(stale)).toEqual([])
      expect(local.listExplicitPageTargets(incoming)).toHaveLength(1)
      expect(local.listCrawlHistory()).toHaveLength(2)
      expect(local.getSettings().theme).toBe('dark')
    }
    await local.importBackupArchive(await source.exportBackupArchive())
    expect(local.getSettings().theme).toBe('dark')
  } finally {
    source.close()
    local.close()
  }
})
