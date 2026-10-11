import { describe, expect, it, vi } from 'vitest'
import type { UrlTreeNode } from '@loci/shared'
import { getLibraryTree } from '@/api/library-browser'
import { filterLibraryTree, libraryFolderKeys, loadLibraryTree } from '../library-tree'

vi.mock('@/api/library-browser', () => ({ getLibraryTree: vi.fn() }))

const tree: UrlTreeNode[] = [
  {
    id: 'reference',
    title: 'reference',
    readable: false,
    children: [
      {
        id: 'react',
        title: 'react',
        readable: false,
        children: [
          { id: 'state', title: 'useState', readable: true },
          { id: 'effect', title: 'useEffect', readable: true }
        ]
      }
    ]
  }
]

describe('文档库目录搜索', () => {
  it('保留深层匹配页的祖先，忽略大小写和首尾空白', () => {
    const result = filterLibraryTree(tree, '  USESTATE  ')
    expect(result[0]?.children?.[0]?.children?.map((node) => node.id)).toEqual(['state'])
    expect(libraryFolderKeys(result)).toEqual(['reference', 'react'])
    expect(filterLibraryTree(tree, 'missing')).toEqual([])
    expect(filterLibraryTree(tree, 'reference')).toEqual(tree)
    expect(tree[0]?.children?.[0]?.children).toHaveLength(2)
  })

  it('完整搜索继续获取 API 深度边界外的目录，包含尚未展开的页面', async () => {
    vi.mocked(getLibraryTree).mockImplementation(async (_location, _library, parent) => ({
      libraryId: 'library',
      title: 'Docs',
      parentId: parent ?? null,
      nodes:
        parent === 'deep'
          ? [{ id: 'state', title: 'useState', readable: true }]
          : [
              {
                id: 'root',
                title: 'root',
                readable: false,
                children: [{ id: 'deep', title: 'deep', readable: false }]
              }
            ]
    }))
    const result = filterLibraryTree(await loadLibraryTree('local', 'library'), 'useState')
    expect(result[0]?.children?.[0]?.children?.[0]?.id).toBe('state')
  })

  it('目录读取失败必须向上抛出，不能当作搜索无结果', async () => {
    vi.mocked(getLibraryTree).mockRejectedValueOnce(new Error('offline'))
    await expect(loadLibraryTree('cloud', 'library')).rejects.toThrow('offline')
  })
})
