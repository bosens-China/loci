import { useCallback, useEffect, useRef } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { canonicalDocumentSearch } from '@/routing'

export interface DocumentRouteState {
  sourceId: string
  documentId: string
  query: string
}

const documentsRoute = getRouteApi('/documents')

/** 文档工作区的 URL 状态：来源、当前文档、搜索词。 */
export function useDocumentRoute(): {
  state: DocumentRouteState
  selectSource: (sourceId: string) => void
  selectDocument: (documentId: string) => void
  setQuery: (query: string) => void
} {
  const search = documentsRoute.useSearch()
  const navigate = documentsRoute.useNavigate()
  const state = {
    sourceId: search.source ?? '',
    documentId: search.doc ?? search.document ?? '',
    query: search.q ?? ''
  }
  const rememberedDocuments = useRef(new Map<string, string>())
  useEffect(() => {
    if (state.sourceId && state.documentId)
      rememberedDocuments.current.set(state.sourceId, state.documentId)
  }, [state.documentId, state.sourceId])
  const write = useCallback(
    (next: Partial<DocumentRouteState>) => {
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
        replace: true,
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
  const selectDocument = useCallback((documentId: string) => write({ documentId }), [write])
  const setQuery = useCallback((query: string) => write({ query, documentId: '' }), [write])
  return {
    state,
    selectSource,
    selectDocument,
    setQuery
  }
}
