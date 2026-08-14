import { describe, expect, it } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS } from '../source-policy.js'
import { deriveSourceName, getSourceScopeOptions } from '../source-url.js'

describe('文档源 URL 默认值', () => {
  it('忽略常见文档子域名生成简短名称', () => {
    expect(deriveSourceName('https://rspress.rs/guide')).toBe('rspress')
    expect(deriveSourceName('https://docs.rsbuild.dev/guide')).toBe('rsbuild')
    expect(deriveSourceName('not a url')).toBe('')
  })

  it('生成从整站到当前路径的范围选项', () => {
    expect(getSourceScopeOptions('https://example.com/guide/start')).toEqual([
      { label: '整个站点', value: '/' },
      { label: '/guide', value: '/guide' },
      { label: '/guide/start', value: '/guide/start' }
    ])
  })

  it('导出所有入口共用的基础值和输入边界', () => {
    expect(DOCUMENT_SOURCE_DEFAULTS).toMatchObject({
      mode: 'auto',
      pageLimit: 1000,
      scopePath: '/',
      httpConcurrency: null,
      browserConcurrency: null
    })
    expect(DOCUMENT_SOURCE_LIMITS).toMatchObject({
      nameLength: { min: 1, max: 100 },
      pageLimit: { min: 1, max: 10_000 },
      concurrency: { min: 1, max: 32 },
      githubSizeMb: { min: 1, max: 10_240 }
    })
  })
})
