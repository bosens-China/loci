import { createLazyRoute, useNavigate } from '@tanstack/react-router'
import LibraryPage from '../components/LibraryPage'
import { useDocuments } from '../hooks/useDocuments'
import { useSources } from '../hooks/useSources'

export const Route = createLazyRoute('/library')({
  component: LibraryRoute
})

function LibraryRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const sources = useSources()
  const documents = useDocuments()
  const sourceId = search.source ?? 'all'

  return (
    <LibraryPage
      sources={sources.sources}
      documents={documents.documents}
      loading={documents.loading}
      error={documents.error}
      sourceId={sourceId}
      selectedDocumentId={search.document ?? ''}
      onSourceChange={(source) =>
        void navigate({
          to: '/library',
          search: { source: source === 'all' ? undefined : source, document: undefined }
        })
      }
      onDocumentSelect={(document) =>
        void navigate({
          to: '/library',
          search: {
            source: sourceId === 'all' ? undefined : sourceId,
            document
          }
        })
      }
      onRetry={() => void documents.reload()}
    />
  )
}
