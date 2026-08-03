import { describe, expect, it } from 'vitest'
import {
  buildDocumentTree,
  filterDocumentsByMarkdown,
  getAncestorKeysForDocument
} from '../documentTree'

const document = {
  id: 'intro',
  sourceId: 'vite',
  sourceName: 'Vite',
  title: '介绍',
  url: 'https://vite.dev/guide/intro',
  folder: 'guide',
  language: 'zh-CN',
  updatedAt: '2026-07-31',
  content: '# 介绍\nReact Compiler'
}

describe('buildDocumentTree', () => {
  it('keeps source and folder nodes non-selectable while leaves remain documents', () => {
    const tree = buildDocumentTree([document])

    expect(tree).toMatchObject([
      {
        key: 'source:vite',
        selectable: false,
        children: [
          {
            key: 'folder:vite:guide',
            selectable: false,
            children: [{ key: 'intro', isLeaf: true }]
          }
        ]
      }
    ])
  })

  it('filters by Markdown content only and ignores case', () => {
    expect(filterDocumentsByMarkdown([document], 'react compiler')).toEqual([document])
    expect(filterDocumentsByMarkdown([document], 'vite')).toEqual([])
  })

  it('returns ancestor keys for expanding target document', () => {
    expect(getAncestorKeysForDocument([document], 'intro')).toEqual([
      'source:vite',
      'folder:vite:guide'
    ])
    expect(getAncestorKeysForDocument([document], 'non-existent')).toEqual([])
  })
})
