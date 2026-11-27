import { useQuery } from '@tanstack/react-query'
import { listLibraries, listLibraryCrawlStatuses } from '@/api/libraries'
import { AsyncState } from '@/components/AsyncState'
import { findRelatedVersionLibraries } from '@/pages/documents/library-filter'
import { LibraryBrowserWorkspace } from '@/pages/documents/LibraryBrowserWorkspace'
import { LocalLibraryCards } from '@/pages/documents/LocalLibraryCards'
import { useDocumentRoute } from '@/pages/documents/use-document-route'

/** 知识管理主页面：文档库概览看板、卡片列表管理与目录阅读工作台。 */
export function DocumentsPage(): React.JSX.Element {
  const { state, selectSource, selectDocument, forgetDocument } = useDocumentRoute()

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

  const allLibraries = libraries.data ?? []
  const selected = allLibraries.find((lib) => lib.id === state.sourceId)
  const versionSiblings = selected ? findRelatedVersionLibraries(allLibraries, selected) : []

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
          category={selected.category}
          version={selected.version}
          versionOptions={versionSiblings}
          fileId={state.documentId}
          onSelectFile={selectDocument}
          onForgetFile={forgetDocument}
          onSelectVersion={selectSource}
          onBack={() => selectSource('')}
        />
      ) : (
        <LocalLibraryCards
          libraries={allLibraries}
          crawlStatuses={crawlStatuses.data ?? []}
          onSelect={selectSource}
        />
      )}
    </AsyncState>
  )
}
