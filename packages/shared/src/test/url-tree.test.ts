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
})
