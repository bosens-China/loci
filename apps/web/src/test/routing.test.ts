import { describe, expect, it } from 'vitest'
import { resolveRoute, routePath } from '@/routing'

describe('Web 路由', () => {
  it('为主页面生成可刷新路径', () => {
    expect(routePath('library')).toBe('/library')
    expect(routePath('cloud')).toBe('/cloud')
    expect(resolveRoute('/jobs')).toBe('jobs')
  })

  it('未知路径回到概览', () => {
    expect(resolveRoute('/missing')).toBe('overview')
  })
})
