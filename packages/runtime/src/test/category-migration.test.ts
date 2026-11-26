import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'
import { expect, it } from 'vitest'
import { createDatabase } from '../database.js'

it('独立进程同时创建和编辑不同库时复用同一新分类', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loci-category-writers-'))
  const file = join(dir, 'test.sqlite')
  try {
    const initial = createDatabase(file)
    const existing = initial.createSource({
      ...DOCUMENT_SOURCE_DEFAULTS,
      name: '旧库',
      url: 'https://old.test'
    })
    initial.close()
    const script = `
      import { createDatabase } from './src/database.ts'
      import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'
      const db = createDatabase(process.argv[1])
      try {
        const category = ' 新分组 '
        if (process.argv[2]) db.updateSource(process.argv[2], { ...db.getSource(process.argv[2]), category })
        else db.createSource({ ...DOCUMENT_SOURCE_DEFAULTS, name: '新库', url: 'https://new.test', category })
      } finally { db.close() }
    `
    await Promise.all(
      [existing.id, ''].map((id) =>
        promisify(execFile)(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '--eval', script, file, id],
          { cwd: new URL('../../', import.meta.url) }
        )
      )
    )
    const db = createDatabase(file)
    try {
      expect(db.listCategories().filter((c) => c.name === '新分组')).toMatchObject([
        { libraryCount: 2 }
      ])
      expect(db.listSources({ category: '新分组' })).toHaveLength(2)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('v21 的空分类、空版本回填并保留原库正文与索引，数据库约束允许不同版本共存', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loci-v21-'))
  const file = join(dir, 'test.sqlite')
  try {
    const original = createDatabase(file)
    const input = { ...DOCUMENT_SOURCE_DEFAULTS, name: '旧库', url: 'https://legacy.test' }
    const source = original.createSource(input)
    original.saveDocument({
      sourceId: source.id,
      url: source.url,
      title: 'legacy',
      markdown: 'legacy',
      language: 'en',
      fetchMode: 'http',
      crawledAt: new Date().toISOString()
    })
    original.close()
    const sqlite = new DatabaseSync(file)
    sqlite.exec(`DROP INDEX document_sources_local_identity;
      ALTER TABLE document_sources DROP COLUMN category; ALTER TABLE document_sources DROP COLUMN version;
      ALTER TABLE document_sources ADD COLUMN category TEXT REFERENCES categories(name) ON DELETE SET NULL;
      ALTER TABLE document_sources ADD COLUMN version TEXT;
      UPDATE document_sources SET version='  '; DELETE FROM categories WHERE name='未分类';
      CREATE UNIQUE INDEX document_sources_local_identity ON document_sources(source_identity) WHERE source_type='local';
      PRAGMA user_version = 21`)
    sqlite.close()
    const db = createDatabase(file)
    try {
      expect(db.getSource(source.id)).toMatchObject({ category: '未分类', version: 'latest' })
      expect(db.searchDocuments('legacy')).toMatchObject([{ sourceId: source.id }])
      const historic = db.createSource({ ...input, version: 'v18' })
      expect(historic.id).not.toBe(source.id)
      expect(db.createSource(input).id).toBe(source.id)
      expect(() => db.updateSource(historic.id, { ...input, version: 'latest' })).toThrow()
      expect(db.getSource(historic.id).version).toBe('v18')
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('从 v20 升级时保留原库并有序预置分类，重启尊重用户删除的分类', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loci-v20-'))
  const file = join(dir, 'test.sqlite')
  try {
    const old = createDatabase(file)
    const defaults = [
      '未分类',
      '前端',
      '后端',
      'AI',
      '数据库',
      '运维与云原生',
      '移动端',
      '工具与其他'
    ]
    expect(old.listCategories().map((c) => c.name)).toEqual(defaults)
    const { id } = old.createSource({
      ...DOCUMENT_SOURCE_DEFAULTS,
      name: '旧库',
      url: 'https://example.test'
    })
    old.close()
    const sqlite = new DatabaseSync(file)
    sqlite.exec(
      'DROP INDEX document_sources_local_identity; ALTER TABLE document_sources DROP COLUMN category; ALTER TABLE document_sources DROP COLUMN version; DROP TABLE categories; PRAGMA user_version = 20'
    )
    sqlite.close()
    const db = createDatabase(file)
    try {
      expect(db.schemaVersion).toBe(22)
      expect(db.getSource(id)).toMatchObject({
        name: '旧库',
        category: '未分类',
        version: 'latest'
      })
      expect(db.listCategories().map((c) => c.name)).toEqual(defaults)
      expect(
        db
          .listCategories()
          .every((c) => c.libraryCount === Number(c.name === '未分类') && c.isDefault)
      ).toBe(true)
      db.deleteCategory('AI')
    } finally {
      db.close()
    }
    const reopened = createDatabase(file)
    try {
      expect(reopened.listCategories().map((c) => c.name)).toEqual(
        defaults.filter((name) => name !== 'AI')
      )
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
