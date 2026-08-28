import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { DocumentSource } from '@loci/shared'
import { getAdminSession } from '@/api/admin'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { ADMIN_SESSION_KEY } from '@/pages/admin/admin-query-keys'
import { isAdminSessionValid } from '@/pages/admin/admin-state'
import { LibraryBrowserWorkspace } from '@/pages/documents/LibraryBrowserWorkspace'
import { LocalLibraryCards } from '@/pages/documents/LocalLibraryCards'
import { useDocumentRoute } from '@/pages/documents/use-document-route'

/** 文档库卡片是一级入口；进入后才按需读取目录和正文。 */
export function DocumentsPage(): React.JSX.Element {
  const { state, selectSource } = useDocumentRoute()
  const navigate = useNavigate()
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const adminSession = useQuery({
    queryKey: ADMIN_SESSION_KEY,
    queryFn: getAdminSession,
    staleTime: 30_000
  })
  const selected = sources.data?.find((source) => source.id === state.sourceId)
  const canPublish = isAdminSessionValid(adminSession.data ?? null)

  const openPublish = (source: DocumentSource): void => {
    void navigate({ to: '/admin/libraries/publish', search: { source: source.id } })
  }

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
        <LocalLibraryCards
          sources={sources.data ?? []}
          onSelect={selectSource}
          onPublish={openPublish}
          canPublish={canPublish}
        />
      )}
    </AsyncState>
  )
}
