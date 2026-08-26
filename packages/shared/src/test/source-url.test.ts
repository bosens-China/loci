import { describe, expect, it } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS } from '../source-policy.js'
import {
  deriveSourceName,
  deriveUrlPathTitle,
  getSourceScopeOptions,
  scopePathContains
} from '../source-url.js'

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

  it('从路径生成候选标题，并按需去除 Markdown 扩展名', () => {
    expect(deriveUrlPathTitle('https://example.com/components/%E6%8C%89%E9%92%AE')).toBe('按钮')
    expect(deriveUrlPathTitle('https://example.com/reference/client.md', true)).toBe('client')
    expect(deriveUrlPathTitle('https://example.com/')).toBe('example.com')
  })

  it('按路径段判断收录范围包含关系', () => {
    expect(scopePathContains('/', '/docs')).toBe(true)
    expect(scopePathContains('/docs', '/docs/api')).toBe(true)
    expect(scopePathContains('/docs/', '/docs')).toBe(true)
    expect(scopePathContains('/doc', '/docs')).toBe(false)
    expect(scopePathContains('/docs/api', '/docs')).toBe(false)
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
