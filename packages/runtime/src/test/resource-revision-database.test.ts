import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'
import { LOCI_DATABASE_SCHEMA } from '../database-schema.js'

describe('资源 revision', () => {
  it('通过触发器观察另一数据库连接的来源、文档、任务和设置写入', () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-resource-revisions-'))
    const filename = join(root, 'loci.sqlite')
    const legacy = new DatabaseSync(filename)
    legacy.exec(`
      ${LOCI_DATABASE_SCHEMA}
      CREATE TABLE resource_revisions (
        resource TEXT PRIMARY KEY CHECK (resource IN ('sources', 'documents', 'jobs', 'settings')),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
      ) STRICT;
      INSERT INTO resource_revisions (resource, revision) VALUES ('sources', 7);
      CREATE TRIGGER resource_revision_document_sources_insert
      AFTER INSERT ON document_sources
      BEGIN
        UPDATE resource_revisions SET revision = revision + 1 WHERE resource = 'sources';
      END;
    `)
    legacy.close()
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

      writer.recordOperationLog({
        category: 'system',
        action: 'test',
        level: 'info',
        message: 'revision test'
      })
      expect(reader.getResourceRevisions().logs).toBeGreaterThan(initial.logs)
    } finally {
      writer.close()
      reader.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
