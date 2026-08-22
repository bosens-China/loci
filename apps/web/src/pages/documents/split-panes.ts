export type DocumentPane = 'source' | 'documents'

export interface DocumentPaneWidths {
  source: number
  documents: number
}

export const DEFAULT_DOCUMENT_PANE_WIDTHS: DocumentPaneWidths = {
  source: 320,
  documents: 360
}

const MINIMUM_WIDTH: Record<DocumentPane, number> = {
  source: 260,
  documents: 280
}
const MINIMUM_READER_WIDTH = 360
const DIVIDER_WIDTH = 16

/** 在保留阅读区最小宽度的前提下约束可拖动分栏。 */
export function resizeDocumentPane(
  widths: DocumentPaneWidths,
  pane: DocumentPane,
  nextWidth: number,
  viewportWidth: number
): DocumentPaneWidths {
  const minimum = MINIMUM_WIDTH[pane]
  const otherWidth = pane === 'source' ? widths.documents : widths.source
  const maximum = Math.max(
    minimum,
    viewportWidth - otherWidth - MINIMUM_READER_WIDTH - DIVIDER_WIDTH
  )
  return { ...widths, [pane]: Math.min(Math.max(nextWidth, minimum), maximum) }
}
