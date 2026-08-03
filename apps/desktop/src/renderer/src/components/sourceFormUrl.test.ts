import { describe, expect, it } from 'vitest'
import { deriveSourceName, getSourceScopeOptions } from './sourceFormUrl'

describe('sourceFormUrl', () => {
  it('从主域名生成默认名称', () => {
    expect(deriveSourceName('https://rspress.rs/guide')).toBe('rspress')
    expect(deriveSourceName('https://docs.rsbuild.dev/guide')).toBe('rsbuild')
    expect(deriveSourceName('not a url')).toBe('')
  })

  it('生成离散路径范围', () => {
    expect(getSourceScopeOptions('https://rspress.rs/guide/start/introduction')).toEqual([
      { label: '整个站点', value: '/' },
      { label: '/guide', value: '/guide' },
      { label: '/guide/start', value: '/guide/start' },
      { label: '/guide/start/introduction', value: '/guide/start/introduction' }
    ])
  })
})
