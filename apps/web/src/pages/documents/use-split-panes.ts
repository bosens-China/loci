import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import {
  DEFAULT_DOCUMENT_PANE_WIDTHS,
  resizeDocumentPane,
  type DocumentPane,
  type DocumentPaneWidths
} from '@/pages/documents/split-panes'

interface DragState {
  pane: DocumentPane
  startX: number
  startWidth: number
}

interface DividerProps {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}

/** 文档工作区的两道分隔条，仅保存当前页面会话的宽度。 */
export function useSplitPanes(): {
  widths: DocumentPaneWidths
  dividerProps: (pane: DocumentPane) => DividerProps
} {
  const [widths, setWidths] = useState(DEFAULT_DOCUMENT_PANE_WIDTHS)
  const drag = useRef<DragState | null>(null)
  const updateWidth = useCallback((pane: DocumentPane, nextWidth: number) => {
    setWidths((current) => resizeDocumentPane(current, pane, nextWidth, window.innerWidth))
  }, [])

  useEffect(() => {
    const constrain = (): void => {
      setWidths((current) => {
        const source = resizeDocumentPane(current, 'source', current.source, window.innerWidth)
        return resizeDocumentPane(source, 'documents', source.documents, window.innerWidth)
      })
    }
    window.addEventListener('resize', constrain)
    return () => window.removeEventListener('resize', constrain)
  }, [])

  const dividerProps = (pane: DocumentPane): DividerProps => ({
    onPointerDown: (event) => {
      drag.current = { pane, startX: event.clientX, startWidth: widths[pane] }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    onPointerMove: (event) => {
      const currentDrag = drag.current
      if (!currentDrag || currentDrag.pane !== pane) return
      updateWidth(pane, currentDrag.startWidth + event.clientX - currentDrag.startX)
    },
    onPointerUp: (event) => {
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancel: () => {
      drag.current = null
    },
    onKeyDown: (event) => {
      const delta = event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0
      if (!delta) return
      event.preventDefault()
      updateWidth(pane, widths[pane] + delta)
    }
  })

  return { widths, dividerProps }
}
