import { describe, expect, it } from 'vitest'
import { buildDocumentTree } from './documentTree'

describe('buildDocumentTree', () => {
  it('keeps source and folder nodes non-selectable while leaves remain documents', () => {
    const tree = buildDocumentTree([
      {
        id: 'intro',
        sourceId: 'vite',
        sourceName: 'Vite',
        title: '介绍',
        url: 'https://vite.dev/guide/intro',
        folder: 'guide',
        language: 'zh-CN',
        updatedAt: '2026-07-31',
        content: '# 介绍'
      }
    ])

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
})
