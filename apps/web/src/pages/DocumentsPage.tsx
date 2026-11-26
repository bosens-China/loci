import { useQuery } from '@tanstack/react-query'
import { listLibraries, listLibraryCrawlStatuses } from '@/api/libraries'
import { AsyncState } from '@/components/AsyncState'
import { LibraryBrowserWorkspace } from '@/pages/documents/LibraryBrowserWorkspace'
import { LocalLibraryCards } from '@/pages/documents/LocalLibraryCards'
import { useDocumentRoute } from '@/pages/documents/use-document-route'

/** 知识管理主页面：文档库概览看板、卡片列表管理与目录阅读工作台。 */
export function DocumentsPage(): React.JSX.Element {
  const { state, selectSource, selectDocument } = useDocumentRoute()

  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: () => listLibraries()
  })

  const crawlStatuses = useQuery({
    queryKey: ['library-crawl-statuses'],
    queryFn: listLibraryCrawlStatuses,
    refetchInterval: (queryState) => {
      const hasRunning = (queryState.state.data ?? []).some((item) => item.status === 'running')
      return hasRunning ? 2000 : 10_000
    }
  })

  const selected = libraries.data?.find((lib) => lib.id === state.sourceId)

  return (
    <AsyncState
      loading={libraries.isLoading}
      error={libraries.error}
      onRetry={() => void libraries.refetch()}
    >
      {selected ? (
        <LibraryBrowserWorkspace
          key={selected.id}
          libraryId={selected.id}
          title={selected.name}
          fileId={state.documentId}
          onSelectFile={selectDocument}
          onBack={() => selectSource('')}
        />
      ) : (
        <LocalLibraryCards
          libraries={libraries.data ?? []}
          crawlStatuses={crawlStatuses.data ?? []}
          onSelect={selectSource}
        />
      )}
    </AsyncState>
  )
}
