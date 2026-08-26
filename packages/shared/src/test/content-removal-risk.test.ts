import { describe, expect, it } from 'vitest'
import {
  getCloudLibraryContentRemovalRisk,
  getDocumentContentRemovalRisk
} from '../content-removal-risk.js'

const documentLocation = {
  kind: 'web' as const,
  url: 'https://example.com/docs',
  scopePath: '/docs',
  excludePathPattern: null
}

describe('正文删除风险', () => {
  it.each([
    ['保持来源与扩大范围', { ...documentLocation, scopePath: '/' }, null],
    ['收窄范围', { ...documentLocation, scopePath: '/docs/api' }, 'scope_narrowed'],
    [
      '新增排除规则',
      { ...documentLocation, excludePathPattern: '^/docs/legacy' },
      'exclusion_changed'
    ],
    [
      '切换 hostname',
      { ...documentLocation, url: 'https://other.example.com/docs' },
      'source_changed'
    ],
    [
      '切换 GitHub 仓库',
      { kind: 'github' as const, url: 'https://github.com/example/other', scopePath: '/' },
      'source_changed'
    ]
  ])('%s 时返回正确风险', (_name, next, expected) => {
    expect(getDocumentContentRemovalRisk(documentLocation, next)).toBe(expected)
  })

  it('清空已有排除规则不会误报为正文删除', () => {
    expect(
      getDocumentContentRemovalRisk(
        { ...documentLocation, excludePathPattern: '^/docs/legacy' },
        documentLocation
      )
    ).toBeNull()
  })

  it('Server 文档库仅在入口或范围收窄时报告风险', () => {
    const library = { url: 'https://example.com/docs', scopePath: '/docs' }
    expect(getCloudLibraryContentRemovalRisk(library, { ...library, scopePath: '/' })).toBeNull()
    expect(getCloudLibraryContentRemovalRisk(library, { ...library, scopePath: '/docs/api' })).toBe(
      'scope_narrowed'
    )
    expect(
      getCloudLibraryContentRemovalRisk(library, { ...library, url: 'https://example.com/guide' })
    ).toBe('url_changed')
  })
})
