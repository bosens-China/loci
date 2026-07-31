import { describe, expect, it } from 'vitest'
import { buildCrawlTree } from './crawlTree'

describe('buildCrawlTree', () => {
  it('keeps each discovered page under the page that linked to it', () => {
    const tree = buildCrawlTree([
      { id: 'root', url: 'https://docs.example.com', title: '首页', status: 'success' },
      {
        id: 'guide',
        url: 'https://docs.example.com/guide',
        title: '指南',
        status: 'success',
        parentId: 'root'
      },
      {
        id: 'install',
        url: 'https://docs.example.com/guide/install',
        title: '安装',
        status: 'success',
        parentId: 'guide'
      },
      {
        id: 'legacy',
        url: 'https://docs.example.com/legacy',
        title: '旧页面',
        status: 'failed',
        parentId: 'missing'
      }
    ])

    expect(tree).toMatchObject({
      id: 'root',
      children: [{ id: 'guide', children: [{ id: 'install' }] }, { id: 'legacy' }]
    })
  })
})
