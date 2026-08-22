import { describe, expect, it } from 'vitest'
import { DEFAULT_DOCUMENT_PANE_WIDTHS, resizeDocumentPane } from '@/pages/documents/split-panes'

describe('文档工作区分栏', () => {
  it('限制最小宽度，并为阅读器保留空间', () => {
    expect(resizeDocumentPane(DEFAULT_DOCUMENT_PANE_WIDTHS, 'source', 1, 1280).source).toBe(260)
    expect(resizeDocumentPane(DEFAULT_DOCUMENT_PANE_WIDTHS, 'documents', 900, 1280).documents).toBe(
      584
    )
  })
})
