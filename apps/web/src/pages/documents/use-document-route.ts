import { useCallback, useEffect, useRef } from 'react'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { canonicalDocumentSearch } from '@/routing'

export interface DocumentRouteState {
  sourceId: string
  documentId: string
  query: string
}

const documentsRoute = getRouteApi('/_app/documents')

/** 文档工作区的 URL 状态：来源、当前文档、搜索词。 */
export function useDocumentRoute(): {
  state: DocumentRouteState
  selectSource: (sourceId: string) => void
  selectDocument: (sourceId: string, documentId: string) => void
  forgetDocument: (sourceId: string, documentId: string) => void
  setQuery: (query: string) => void
} {
  const router = useRouter()
  const search = documentsRoute.useSearch()
  const navigate = documentsRoute.useNavigate()
  const state = {
    sourceId: search.source ?? '',
    documentId: search.doc ?? search.document ?? '',
    query: search.q ?? ''
  }
  const rememberedDocuments = useRef(new Map<string, string>())
  useEffect(() => {
    if (!state.sourceId) return
    if (state.documentId) rememberedDocuments.current.set(state.sourceId, state.documentId)
    else rememberedDocuments.current.delete(state.sourceId)
  }, [state.documentId, state.sourceId])
  const write = useCallback(
    (next: Partial<DocumentRouteState>, replace = true) => {
      void navigate({
        search: (previous) => {
          const merged = {
            sourceId: previous.source ?? '',
            documentId: previous.doc ?? previous.document ?? '',
            query: previous.q ?? '',
            ...next
          }
          return canonicalDocumentSearch({
            source: merged.sourceId,
            doc: merged.documentId,
            q: merged.query
          })
        },
        replace,
        resetScroll: false
      })
    },
    [navigate]
  )
  const selectSource = useCallback(
    (sourceId: string) =>
      write({ sourceId, documentId: rememberedDocuments.current.get(sourceId) ?? '' }),
    [write]
  )
  // 异步写操作完成时重新读取导航目的地，避免切换版本或离开工作区后改写 URL。
  const isCurrent = useCallback(
    (sourceId: string, documentId?: string) => {
      const location = router.buildLocation({ search: true })
      const current = canonicalDocumentSearch(location.search)
      return (
        location.pathname === '/documents' &&
        current.source === sourceId &&
        (documentId === undefined || current.doc === documentId)
      )
    },
    [router]
  )
  const selectDocument = useCallback(
    (sourceId: string, documentId: string) => {
      if (isCurrent(sourceId)) write({ documentId }, false)
    },
    [isCurrent, write]
  )
  const forgetDocument = useCallback(
    (sourceId: string, documentId: string) => {
      if (rememberedDocuments.current.get(sourceId) === documentId) {
        rememberedDocuments.current.delete(sourceId)
      }
      if (isCurrent(sourceId, documentId)) write({ documentId: '' })
    },
    [isCurrent, write]
  )
  const setQuery = useCallback((query: string) => write({ query, documentId: '' }), [write])
  return {
    state,
    selectSource,
    selectDocument,
    forgetDocument,
    setQuery
  }
}
