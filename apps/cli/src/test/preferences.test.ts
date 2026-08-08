import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, type LociDatabase } from '@loci/runtime'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/core'
import {
  readAdminCreatePreference,
  readAdminSyncSelection,
  readSourceCreatePreference,
  saveAdminCreatePreference,
  saveAdminSyncSelection,
  saveSourceCreatePreference,
  scopeAtDepth,
  scopeDepth
} from '../preferences.js'

describe('CLI 交互偏好', () => {
  let database: LociDatabase | undefined

  afterEach(() => {
    database?.close()
    database = undefined
  })

  it('持久化安全配置，并按 Server 地址隔离 Admin 偏好', () => {
    database = createDatabase(':memory:')
    saveSourceCreatePreference(database, {
      mode: 'http',
      pageLimit: 2000,
      scopeDepth: 1,
      syncAfterCreate: false
    })
    saveAdminCreatePreference(database, 'HTTP://LOCALHOST:7001/', {
      pageLimit: 3000,
      scopeDepth: 2,
      schedule: '0 2 * * *'
    })
    saveAdminSyncSelection(database, 'http://localhost:7001', ['one', 'two'])

    expect(readSourceCreatePreference(database)).toMatchObject({
      mode: 'http',
      pageLimit: 2000,
      scopeDepth: 1,
      syncAfterCreate: false
    })
    expect(readAdminCreatePreference(database, 'http://localhost:7001')).toMatchObject({
      pageLimit: 3000,
      scopeDepth: 2,
      schedule: '0 2 * * *'
    })
    expect(readAdminSyncSelection(database, 'http://localhost:7001/')).toEqual(['one', 'two'])
    expect(readAdminSyncSelection(database, 'https://cloud.example.com')).toEqual([])
  })

  it('以范围层级复用偏好，避免把旧站点路径原样带到新站点', () => {
    const oldUrl = 'https://example.com/docs/guide/start'
    const depth = scopeDepth(oldUrl, '/docs/guide')

    expect(scopeAtDepth('https://another.example.com/api/reference/index', depth)).toBe(
      '/api/reference'
    )
  })

  it('损坏或过期的偏好会回退到安全默认值', () => {
    database = createDatabase(':memory:')
    database.setInteractionPreference('cli', 'source-create', { pageLimit: -1 })

    expect(readSourceCreatePreference(database)).toEqual({
      mode: DOCUMENT_SOURCE_DEFAULTS.mode,
      pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
      scopeDepth: 0,
      syncAfterCreate: true
    })
  })
})
