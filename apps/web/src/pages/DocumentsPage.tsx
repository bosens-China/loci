import { useQuery } from '@tanstack/react-query'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { LibraryBrowserWorkspace } from '@/pages/documents/LibraryBrowserWorkspace'
import { LocalLibraryCards } from '@/pages/documents/LocalLibraryCards'
import { useDocumentRoute } from '@/pages/documents/use-document-route'

/** 文档库卡片是一级入口；进入后才按需读取目录和正文。 */
export function DocumentsPage(): React.JSX.Element {
  const { state, selectSource } = useDocumentRoute()
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const selected = sources.data?.find((source) => source.id === state.sourceId)

  return (
    <AsyncState
      loading={sources.isLoading}
      error={sources.error}
      onRetry={() => void sources.refetch()}
    >
      {selected ? (
        <LibraryBrowserWorkspace
          location="local"
          libraryId={selected.id}
          title={selected.name}
          onBack={() => selectSource('')}
        />
      ) : (
        <LocalLibraryCards sources={sources.data ?? []} onSelect={selectSource} />
      )}
    </AsyncState>
  )
}
