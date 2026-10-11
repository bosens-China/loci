import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, type LociDatabase } from '@loci/runtime'
import { readAdminSyncSelection, saveAdminSyncSelection } from '../preferences.js'

describe('CLI 交互偏好', () => {
  let database: LociDatabase | undefined
  afterEach(() => database?.close())

  it('按规范化 Server 地址隔离同步选择', () => {
    database = createDatabase(':memory:')
    saveAdminSyncSelection(database, 'HTTP://LOCALHOST:7001/', ['one', 'two'])
    expect(readAdminSyncSelection(database, 'http://localhost:7001')).toEqual(['one', 'two'])
    expect(readAdminSyncSelection(database, 'https://cloud.example.com')).toEqual([])
  })
})
