import { useDeferredValue, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDocument, listDocuments } from '@/api/documents'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { DocumentListPanel } from '@/pages/documents/DocumentListPanel'
import { DocumentReaderPanel } from '@/pages/documents/DocumentReaderPanel'
import { SourcePanel } from '@/pages/documents/SourcePanel'
import { resolveDocumentSelection } from '@/pages/documents/document-selection'
import { migrateLegacyDocumentPath, useDocumentRoute } from '@/pages/documents/use-document-route'
import { useSplitPanes } from '@/pages/documents/use-split-panes'

/** 来源管理 + 文档列表 + 阅读器三栏工作区。 */
export function DocumentsPage(): React.JSX.Element {
  const { state, selectSource, selectDocument, setQuery } = useDocumentRoute()
  const splitPanes = useSplitPanes()
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const deferredQuery = useDeferredValue(state.query.trim())
  const documents = useQuery({
    queryKey: ['documents', deferredQuery, state.sourceId],
    queryFn: () => listDocuments(deferredQuery, state.sourceId),
    enabled: Boolean(state.sourceId)
  })
  const selectedDocumentId = resolveDocumentSelection(documents.data, state.documentId)
  const document = useQuery({
    queryKey: ['document', state.sourceId, selectedDocumentId],
    queryFn: () => getDocument(selectedDocumentId),
    enabled: Boolean(state.sourceId && selectedDocumentId)
  })

  useEffect(() => {
    migrateLegacyDocumentPath(window.location.pathname)
  }, [])

  useEffect(() => {
    if (
      !state.sourceId ||
      !documents.data ||
      !selectedDocumentId ||
      selectedDocumentId === state.documentId
    ) {
      return
    }

    selectDocument(selectedDocumentId)
  }, [documents.data, selectDocument, selectedDocumentId, state.documentId, state.sourceId])

  const selectedSource = sources.data?.find((source) => source.id === state.sourceId)

  return (
    <AsyncState
      loading={sources.isLoading}
      error={sources.error}
      onRetry={() => void sources.refetch()}
    >
      <div className="flex h-[calc(100vh-3.25rem)] min-w-0">
        <div className="h-full shrink-0" style={{ width: splitPanes.widths.source }}>
          <SourcePanel selectedId={state.sourceId} onSelect={selectSource} />
        </div>
        <PaneDivider
          pane="source"
          label="调整文档来源宽度"
          value={splitPanes.widths.source}
          dividerProps={splitPanes.dividerProps}
        />
        <div className="h-full shrink-0" style={{ width: splitPanes.widths.documents }}>
          <DocumentListPanel
            sourceId={state.sourceId}
            source={selectedSource}
            query={state.query}
            selectedId={selectedDocumentId}
            documents={documents.data}
            loading={documents.isLoading}
            error={documents.error}
            onQueryChange={setQuery}
            onSelect={selectDocument}
            onRetry={() => void documents.refetch()}
          />
        </div>
        <PaneDivider
          pane="documents"
          label="调整文档树宽度"
          value={splitPanes.widths.documents}
          dividerProps={splitPanes.dividerProps}
        />
        <DocumentReaderPanel
          document={document.data ?? null}
          loading={Boolean(state.sourceId) && (documents.isLoading || document.isLoading)}
          error={document.error}
          onRetry={() => void document.refetch()}
        />
      </div>
    </AsyncState>
  )
}

function PaneDivider(props: {
  pane: 'source' | 'documents'
  label: string
  value: number
  dividerProps: ReturnType<typeof useSplitPanes>['dividerProps']
}): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-label={props.label}
      aria-orientation="vertical"
      aria-valuenow={props.value}
      tabIndex={0}
      className="focus-ring z-10 h-full w-2 shrink-0 cursor-col-resize border-x border-[#d8e0e0] bg-[#f6f9f8] hover:bg-accent/20"
      {...props.dividerProps(props.pane)}
    />
  )
}
