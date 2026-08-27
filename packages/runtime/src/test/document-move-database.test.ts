import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

describe('多文档事务移动', () => {
  it('创建目标、移动正文、删除空来源并幂等复用', () => {
    const database = createDatabase(':memory:')
    try {
      const first = createSource(database, 'First', 'https://first.example.com')
      const second = createSource(database, 'Second', 'https://second.example.com')
      for (const [sourceId, url, title] of [
        [first.id, first.url, 'Alpha'],
        [second.id, second.url, 'Beta']
      ] as const) {
        database.saveDocument({
          sourceId,
          url,
          title,
          markdown: `# ${title}`,
          language: 'en',
          fetchMode: 'http',
          crawledAt: '2026-08-27T00:00:00.000Z'
        })
      }
      const ids = database.listDocuments().map((item) => item.id)
      const input = {
        operationId: 'move-documents-1',
        documentIds: ids,
        target: sourceInput('Combined', 'https://combined.example.com/docs')
      }
      const moved = database.moveDocumentsToNewSource(input)
      const repeated = database.moveDocumentsToNewSource(input)

      expect(moved).toMatchObject({ moved: 2, reused: false })
      expect(moved.deletedSourceIds.sort()).toEqual([first.id, second.id].sort())
      expect(repeated).toMatchObject({ moved: 2, reused: true, target: { id: moved.target.id } })
      expect(database.listSources()).toHaveLength(1)
      expect(database.searchDocuments('Alpha')[0]).toMatchObject({
        sourceId: moved.target.id,
        sourceName: 'Combined'
      })
    } finally {
      database.close()
    }
  })
})

function createSource(database: ReturnType<typeof createDatabase>, name: string, url: string) {
  return database.createSource(sourceInput(name, url))
}

function sourceInput(name: string, url: string) {
  return {
    name,
    url,
    mode: 'auto' as const,
    pageLimit: 100,
    scopePath: '/',
    schedule: null,
    httpConcurrency: null,
    browserConcurrency: null
  }
}
