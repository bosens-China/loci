import { describe, expect, it } from 'vitest'
import { resolveRoute, routePath } from '@/routing'

describe('Web 路由', () => {
  it('为主页面生成可刷新路径', () => {
    expect(routePath('documents')).toBe('/documents')
    expect(routePath('cloud')).toBe('/cloud')
    expect(routePath('admin')).toBe('/admin')
    expect(resolveRoute('/jobs')).toBe('jobs')
    expect(resolveRoute('/admin')).toBe('admin')
  })

  it('旧路径映射到文档工作区', () => {
    expect(resolveRoute('/sources')).toBe('documents')
    expect(resolveRoute('/library')).toBe('documents')
  })

  it('未知路径回到概览', () => {
    expect(resolveRoute('/missing')).toBe('overview')
  })
})
