import { describe, expect, it } from 'vitest'
import { getLibrarySchedulePreview, getLibraryUrlDefaults } from '../library-form'

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

  it('只为有效计划返回运行时间', () => {
    const fromValidSchedule = getLibrarySchedulePreview('0 2 * * *')
    expect(fromValidSchedule).toHaveLength(2)
    expect(getLibrarySchedulePreview('0 2')).toEqual([])
    expect(getLibrarySchedulePreview(null)).toEqual([])
  })
})
