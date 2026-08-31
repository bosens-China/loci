import { describe, expect, it } from 'vitest'
import { buildUrlTree, getUrlTreeSlice } from '../url-tree.js'

describe('buildUrlTree', () => {
  it('builds stable folders while keeping database IDs on readable files', () => {
    expect(
      buildUrlTree(
        [
          { id: 'file-2', title: '配置', url: 'https://example.com/guide/config' },
          { id: 'file-1', title: '开始', url: 'https://example.com/guide/start' }
        ],
        'docs'
      )
    ).toEqual([
      {
        id: 'folder:docs:guide',
        title: 'guide',
        readable: false,
        children: [
          { id: 'file-1', title: '开始', readable: true },
          { id: 'file-2', title: '配置', readable: true }
        ]
      }
    ])
  })

  it('expands a selected folder to a bounded depth', () => {
    const tree = buildUrlTree(
      [{ id: 'file-1', title: '开始', url: 'https://example.com/guide/basic/start' }],
      'docs'
    )
    expect(getUrlTreeSlice(tree, undefined, 1)).toEqual([
      { id: 'folder:docs:guide', title: 'guide', readable: false }
    ])
    expect(getUrlTreeSlice(tree, 'folder:docs:guide', 1)).toEqual([
      { id: 'folder:docs:guide/basic', title: 'basic', readable: false }
    ])
  })

  it('prefers a logical document path over the source URL path', () => {
    expect(
      buildUrlTree(
        [
          {
            id: 'operation',
            title: '读取条目',
            url: 'https://example.com/v3/api-docs/all#operation',
            relativePath: 'all/条目管理/read_item.md'
          },
          {
            id: 'model',
            title: 'Item',
            url: 'https://example.com/v3/api-docs/all#model',
            path: 'all/数据模型/Item.md'
          }
        ],
        'openapi'
      )
    ).toEqual([
      {
        id: 'folder:openapi:all',
        title: 'all',
        readable: false,
        children: [
          {
            id: 'folder:openapi:all/数据模型',
            title: '数据模型',
            readable: false,
            children: [{ id: 'model', title: 'Item', readable: true }]
          },
          {
            id: 'folder:openapi:all/条目管理',
            title: '条目管理',
            readable: false,
            children: [{ id: 'operation', title: '读取条目', readable: true }]
          }
        ]
      }
    ])
  })

  it('keeps every ancestor for repository documents without compressing the path', () => {
    expect(
      buildUrlTree(
        [
          {
            id: 'readme',
            title: 'README.MD',
            url: 'https://github.com/example/repo/blob/commit/README.MD',
            relativePath: 'README.MD'
          },
          {
            id: 'guide',
            title: 'intro.MDX',
            url: 'https://github.com/example/repo/blob/commit/docs/guides/intro.MDX',
            relativePath: 'docs/guides/intro.MDX'
          }
        ],
        'repository'
      )
    ).toEqual([
      {
        id: 'folder:repository:docs',
        title: 'docs',
        readable: false,
        children: [
          {
            id: 'folder:repository:docs/guides',
            title: 'guides',
            readable: false,
            children: [{ id: 'guide', title: 'intro.MDX', readable: true }]
          }
        ]
      },
      { id: 'readme', title: 'README.MD', readable: true }
    ])
  })
})
