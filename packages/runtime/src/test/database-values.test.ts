import { describe, expect, it } from 'vitest'
import { toDocumentSummary } from '../database-values.js'

describe('toDocumentSummary', () => {
  it('exposes the logical relative path used by directory browsing', () => {
    expect(
      toDocumentSummary({
        id: 'document-1',
        source_id: 'source-1',
        source_name: '接口文档',
        title: '查询拓扑数据',
        url: 'https://api.example.com/v3/api-docs/all#operation',
        language: 'und',
        crawled_at: '2026-08-31T00:00:00.000Z',
        relative_path: 'all/电站总览/getTopologyMeterData.md'
      })
    ).toMatchObject({
      relativePath: 'all/电站总览/getTopologyMeterData.md',
      folder: 'all / 电站总览',
      updatedAt: '2026-08-31T00:00:00.000Z'
    })
  })
})
