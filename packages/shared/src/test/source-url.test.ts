import { describe, expect, it } from 'vitest'
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
})
