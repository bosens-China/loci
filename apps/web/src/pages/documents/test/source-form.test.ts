import { describe, expect, it } from 'vitest'
import { toSourceInput } from '../source-form'

describe('文档源表单提交契约', () => {
  it('高级设置尚未挂载时补齐网页抓取默认值', () => {
    expect(
      toSourceInput({
        name: ' 运维平台接口 ',
        url: ' http://10.2.34.132:18080/doc.html#/home ',
        kind: 'web',
        scopePath: '/'
      })
    ).toEqual({
      name: '运维平台接口',
      url: 'http://10.2.34.132:18080/doc.html#/home',
      kind: 'web',
      mode: 'auto',
      pageLimit: 1000,
      scopePath: '/',
      excludePathPattern: null,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null,
      githubArchiveLimitMb: null,
      githubMarkdownLimitMb: null
    })
  })

  it('保留用户已经设置的网页高级配置', () => {
    expect(
      toSourceInput({
        name: 'Docs',
        url: 'https://example.com/docs',
        kind: 'web',
        mode: 'browser',
        pageLimit: 200,
        scopePath: '/docs',
        excludePathPattern: ' ^/docs/legacy ',
        schedule: '0 2 * * *',
        httpConcurrency: 8,
        browserConcurrency: 4
      })
    ).toMatchObject({
      mode: 'browser',
      pageLimit: 200,
      scopePath: '/docs',
      excludePathPattern: '^/docs/legacy',
      schedule: '0 2 * * *',
      httpConcurrency: 8,
      browserConcurrency: 4
    })
  })
})
