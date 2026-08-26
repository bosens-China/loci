import { describe, expect, it } from 'vitest'
import {
  getLocalLibraryRemovalWarning,
  getLibraryUrlDefaults,
  validateLibrarySourceKind
} from '../library-form'

describe('文档库共享表单默认值', () => {
  it('从 URL 推导名称并修复失效的收录范围', () => {
    expect(
      getLibraryUrlDefaults({
        url: 'https://docs.rsbuild.dev/guide/start',
        name: '',
        scopePath: '/old',
        nameTouched: false,
        suggestName: true
      })
    ).toEqual({ name: 'rsbuild', scopePath: '/' })
  })

  it('不覆盖用户主动输入的名称', () => {
    expect(
      getLibraryUrlDefaults({
        url: 'https://hono.dev/docs/',
        name: '我的 Hono 文档',
        scopePath: '/docs',
        nameTouched: true,
        suggestName: true
      })
    ).toEqual({})
  })

  it('GitHub 来源使用仓库名称', () => {
    expect(
      getLibraryUrlDefaults({
        url: 'https://github.com/honojs/hono',
        name: '',
        scopePath: '/',
        nameTouched: false,
        suggestName: true
      })
    ).toMatchObject({ name: 'hono' })
  })

  it('校验顶层来源类型与 URL 是否一致', () => {
    expect(validateLibrarySourceKind('github', 'https://github.com/honojs/hono')).toBeNull()
    expect(validateLibrarySourceKind('web', 'https://hono.dev/docs')).toBeNull()
    expect(validateLibrarySourceKind('github', 'https://hono.dev/docs')).toBe(
      '请输入公开 GitHub 仓库首页 URL'
    )
    expect(validateLibrarySourceKind('web', 'https://github.com/honojs/hono')).toBe(
      'GitHub 仓库请切换到“GitHub 仓库”来源'
    )
  })

  it('在共享删除风险存在时返回确认内容', () => {
    const current = {
      kind: 'web' as const,
      url: 'https://example.com/docs',
      scopePath: '/docs',
      excludePathPattern: null
    }
    expect(getLocalLibraryRemovalWarning(current, current)).toBeNull()
    expect(getLocalLibraryRemovalWarning(current, { ...current, scopePath: '/' })).toBeNull()
    expect(
      getLocalLibraryRemovalWarning(current, { ...current, scopePath: '/docs/api' })
    ).toBeTypeOf('string')
    expect(
      getLocalLibraryRemovalWarning(current, {
        ...current,
        excludePathPattern: '^/docs/legacy(?:/|$)'
      })
    ).toBeTypeOf('string')
    expect(
      getLocalLibraryRemovalWarning(
        { ...current, excludePathPattern: '^/docs/legacy(?:/|$)' },
        current
      )
    ).toBeNull()
    expect(
      getLocalLibraryRemovalWarning(current, {
        ...current,
        url: 'https://new.example.com/docs'
      })
    ).toBeTypeOf('string')
    expect(
      getLocalLibraryRemovalWarning(
        {
          ...current,
          kind: 'github',
          url: 'https://github.com/example/docs',
          scopePath: '/'
        },
        {
          ...current,
          kind: 'github',
          url: 'https://github.com/example/other',
          scopePath: '/'
        }
      )
    ).toBeTypeOf('string')
  })
})
