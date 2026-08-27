import { describe, expect, it } from 'vitest'
import { ServerDatabase } from '../database.js'

describe('Server hostname 抓取规则', () => {
  it('使用 Drizzle 幂等保存并实时读取更新', () => {
    const database = new ServerDatabase(':memory:')
    try {
      const first = database.hostnamePolicies.save({
        hostname: 'Docs.Example.com',
        httpConcurrency: 2,
        browserConcurrency: null,
        batchIntervalMinSeconds: 100,
        batchIntervalMaxSeconds: 300
      })
      const updated = database.hostnamePolicies.save({
        ...first,
        httpConcurrency: 5,
        batchIntervalMinSeconds: 0,
        batchIntervalMaxSeconds: 0
      })

      expect(database.hostnamePolicies.list()).toHaveLength(1)
      expect(database.hostnamePolicies.get('docs.example.com')).toMatchObject({
        hostname: 'docs.example.com',
        httpConcurrency: 5
      })
      expect(updated.updatedAt).toEqual(expect.any(String))
      expect(database.hostnamePolicies.delete('docs.example.com')).toBe(true)
    } finally {
      database.close()
    }
  })
})
