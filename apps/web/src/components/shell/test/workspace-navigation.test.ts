import { describe, expect, it } from 'vitest'
import { isCloudRoute, isStandaloneRoute, resolveActiveMenuKey } from '../navigation-utils'

describe('工作区与导航辅助函数', () => {
  it('正确判断是否为独立全屏页面', () => {
    expect(isStandaloneRoute('/login')).toBe(true)
    expect(isStandaloneRoute('/unknown-404')).toBe(true)
    expect(isStandaloneRoute('/some/invalid/nested/path')).toBe(true)
    expect(isStandaloneRoute('/')).toBe(false)
    expect(isStandaloneRoute('/documents')).toBe(false)
    expect(isStandaloneRoute('/admin/browser')).toBe(false)
  })

  it('正确判断是否为云端控制台路由', () => {
    expect(isCloudRoute('/admin')).toBe(true)
    expect(isCloudRoute('/admin/libraries')).toBe(true)
    expect(isCloudRoute('/')).toBe(false)
    expect(isCloudRoute('/documents')).toBe(false)
    expect(isCloudRoute('/jobs')).toBe(false)
  })

  it('根据 pathname 解析高亮菜单 key', () => {
    expect(resolveActiveMenuKey('/')).toBe('/')
    expect(resolveActiveMenuKey('/documents')).toBe('/documents')
    expect(resolveActiveMenuKey('/browser')).toBe('/browser')
    expect(resolveActiveMenuKey('/admin')).toBe('/admin')
    expect(resolveActiveMenuKey('/admin/jobs')).toBe('/admin/jobs')
    expect(resolveActiveMenuKey('/admin/hostname-policies')).toBe('/admin/hostname-policies')
    expect(resolveActiveMenuKey('/admin/browser')).toBe('/admin/browser')
    expect(resolveActiveMenuKey('/admin/publish')).toBe('/admin/publish')
    expect(resolveActiveMenuKey('/unknown')).toBe('/')
  })
})
