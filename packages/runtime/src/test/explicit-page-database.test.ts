import { describe, expect, it } from 'vitest'
import type { ExplicitPageResult } from '@loci/core'
import { createDatabase } from '../database.js'

describe('explicit page database', () => {
  it('插入、保持不变，并在 404 时移除正文但保留目标', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createSource(database)
      const url = 'https://docs.example.com/api/new'
      database.registerExplicitPageTargets(source.id, [url])
      expect(database.commitExplicitPageResults(source.id, [fetched(url)], 'http', null)).toEqual([
        { url, status: 'inserted' }
      ])
      expect(database.commitExplicitPageResults(source.id, [fetched(url)], 'http', null)).toEqual([
        { url, status: 'unchanged' }
      ])
      expect(database.commitExplicitPageResults(source.id, [missing(url)], 'http', null)).toEqual([
        { url, status: 'missing', message: 'HTTP 404' }
      ])
      expect(database.listDocuments()).toHaveLength(0)
      expect(database.listExplicitPageTargets(source.id)).toMatchObject([
        { url, status: 'missing', lastError: 'HTTP 404' }
      ])
    } finally {
      database.close()
    }
  })

  it('收窄 scope 时保留显式越界页，exclude 命中时删除目标与正文', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createSource(database)
      const url = 'https://docs.example.com/api/new'
      database.registerExplicitPageTargets(source.id, [url])
      database.commitExplicitPageResults(source.id, [fetched(url)], 'http', null)
      database.updateSource(source.id, sourceInput(null))
      expect(database.listDocuments()).toHaveLength(1)

      database.updateSource(source.id, sourceInput('^/api(?:/|$)'))
      expect(database.listDocuments()).toHaveLength(0)
      expect(database.listExplicitPageTargets(source.id)).toEqual([])
    } finally {
      database.close()
    }
  })

  it('更换 hostname 时删除旧显式目标与正文', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createSource(database)
      const url = 'https://docs.example.com/api/new'
      database.registerExplicitPageTargets(source.id, [url])
      database.commitExplicitPageResults(source.id, [fetched(url)], 'http', null)

      database.updateSource(
        source.id,
        sourceInput(null, 'https://new-docs.example.com/guide/start')
      )

      expect(database.listDocuments()).toEqual([])
      expect(database.listExplicitPageTargets(source.id)).toEqual([])
    } finally {
      database.close()
    }
  })

  it('网页文档源改为 GitHub 时清除显式页面目标', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createSource(database)
      const url = 'https://docs.example.com/api/new'
      database.registerExplicitPageTargets(source.id, [url])
      database.commitExplicitPageResults(source.id, [fetched(url)], 'http', null)

      database.updateSource(source.id, sourceInput(null, 'https://github.com/example/docs'))

      expect(database.listExplicitPageTargets(source.id)).toEqual([])
    } finally {
      database.close()
    }
  })

  it('备份与恢复显式页面目标', () => {
    const sourceDatabase = createDatabase(':memory:')
    const targetDatabase = createDatabase(':memory:')
    try {
      const source = createSource(sourceDatabase)
      const url = 'https://docs.example.com/api/new'
      sourceDatabase.registerExplicitPageTargets(source.id, [url])
      sourceDatabase.commitExplicitPageResults(source.id, [fetched(url)], 'http', null)
      targetDatabase.importBackup(sourceDatabase.exportBackup())
      expect(targetDatabase.listExplicitPageTargets(source.id)).toMatchObject([
        { url, status: 'current' }
      ])
    } finally {
      sourceDatabase.close()
      targetDatabase.close()
    }
  })
})

type Database = ReturnType<typeof createDatabase>

function createSource(database: Database) {
  return database.createSource(sourceInput(null))
}

function sourceInput(
  excludePathPattern: string | null,
  url = 'https://docs.example.com/guide/start'
) {
  return {
    name: 'Docs',
    url,
    mode: 'http' as const,
    pageLimit: 10,
    scopePath: '/guide',
    excludePathPattern,
    schedule: null,
    httpConcurrency: null,
    browserConcurrency: null
  }
}

function fetched(url: string): ExplicitPageResult {
  return {
    url,
    status: 'fetched',
    document: {
      url,
      title: 'New API',
      markdown: '# API',
      language: 'en',
      fetchMode: 'http',
      crawledAt: '2026-08-25T00:00:00.000Z'
    }
  }
}

function missing(url: string): ExplicitPageResult {
  return {
    url,
    status: 'missing',
    failure: {
      url,
      reason: 'not_found',
      message: 'HTTP 404',
      retryable: false,
      statusCode: 404
    }
  }
}
