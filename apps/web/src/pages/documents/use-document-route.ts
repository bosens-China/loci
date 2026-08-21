import { useCallback, useEffect, useState } from 'react'

export interface DocumentRouteState {
  sourceId: string
  documentId: string
  query: string
}

/** 文档工作区的 URL 状态：来源、当前文档、搜索词。 */
export function useDocumentRoute(): {
  state: DocumentRouteState
  selectSource: (sourceId: string) => void
  selectDocument: (documentId: string) => void
  setQuery: (query: string) => void
} {
  const [, tick] = useState(0)
  useEffect(() => {
    const update = (): void => tick((value) => value + 1)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  const state = readDocumentRoute()
  const write = useCallback((next: Partial<DocumentRouteState>) => {
    const url = new URL(window.location.href)
    url.pathname = '/documents'
    const merged = { ...readDocumentRoute(), ...next }
    if (merged.sourceId) url.searchParams.set('source', merged.sourceId)
    else url.searchParams.delete('source')
    if (merged.documentId) url.searchParams.set('doc', merged.documentId)
    else url.searchParams.delete('doc')
    if (merged.query) url.searchParams.set('q', merged.query)
    else url.searchParams.delete('q')
    window.history.replaceState({}, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])
  return {
    state,
    selectSource: (sourceId) => write({ sourceId, documentId: '' }),
    selectDocument: (documentId) => write({ documentId }),
    setQuery: (query) => write({ query, documentId: '' })
  }
}

function readDocumentRoute(): DocumentRouteState {
  const params = new URLSearchParams(window.location.search)
  return {
    sourceId: params.get('source') ?? '',
    documentId: params.get('doc') ?? params.get('document') ?? '',
    query: params.get('q') ?? ''
  }
}

/** 从旧 /library、/sources 链接迁移 query 参数。 */
export function migrateLegacyDocumentPath(pathname: string): void {
  if (pathname !== '/library' && pathname !== '/sources') return
  const url = new URL(window.location.href)
  url.pathname = '/documents'
  const legacyDoc = url.searchParams.get('document')
  if (legacyDoc && !url.searchParams.get('doc')) {
    url.searchParams.set('doc', legacyDoc)
    url.searchParams.delete('document')
  }
  window.history.replaceState({}, '', url)
}
