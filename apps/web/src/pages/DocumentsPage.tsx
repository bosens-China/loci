import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listDocuments } from '@/api/documents'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { DocumentListPanel } from '@/pages/documents/DocumentListPanel'
import { DocumentReaderPanel } from '@/pages/documents/DocumentReaderPanel'
import { SourcePanel } from '@/pages/documents/SourcePanel'
import { migrateLegacyDocumentPath, useDocumentRoute } from '@/pages/documents/use-document-route'

/** 来源管理 + 文档列表 + 阅读器三栏工作区。 */
export function DocumentsPage(): React.JSX.Element {
  const route = useDocumentRoute()
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const deferredQuery = route.state.query.trim()
  const documents = useQuery({
    queryKey: ['documents', deferredQuery, route.state.sourceId],
    queryFn: () => listDocuments(deferredQuery, route.state.sourceId),
    enabled: Boolean(route.state.sourceId)
  })

  useEffect(() => {
    migrateLegacyDocumentPath(window.location.pathname)
  }, [])

  const selectedSource = sources.data?.find((source) => source.id === route.state.sourceId)
  const selectedDocument =
    documents.data?.find((document) => document.id === route.state.documentId) ?? null
  const readerDocument = selectedDocument ?? documents.data?.[0] ?? null

  return (
    <AsyncState
      loading={sources.isLoading}
      error={sources.error}
      onRetry={() => void sources.refetch()}
    >
      <div className="grid h-[calc(100vh-3.25rem)] grid-cols-[260px_auto_1fr]">
        <SourcePanel selectedId={route.state.sourceId} onSelect={route.selectSource} />
        <DocumentListPanel
          sourceId={route.state.sourceId}
          sourceName={selectedSource?.name ?? ''}
          query={route.state.query}
          selectedId={readerDocument?.id ?? ''}
          onQueryChange={route.setQuery}
          onSelect={route.selectDocument}
        />
        <DocumentReaderPanel document={route.state.sourceId ? readerDocument : null} />
      </div>
    </AsyncState>
  )
}
