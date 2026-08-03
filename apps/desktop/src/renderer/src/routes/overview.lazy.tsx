import { createLazyRoute, useNavigate } from '@tanstack/react-router'
import OverviewPage from '../components/OverviewPage'
import { useDocuments } from '../hooks/useDocuments'
import { useSources } from '../hooks/useSources'

export const Route = createLazyRoute('/')({
  component: OverviewRoute
})

function OverviewRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const sources = useSources()
  const documents = useDocuments()

  return (
    <OverviewPage
      sources={sources.sources}
      documents={documents.documents}
      loading={sources.loading || documents.loading}
      error={sources.error ?? documents.error}
      onRetry={() => void Promise.all([sources.reload(), documents.reload()])}
      onOpenSources={() => void navigate({ to: '/sources', search: { tab: undefined } })}
      onSelectSource={(sourceId) =>
        void navigate({ to: '/library', search: { source: sourceId, document: undefined } })
      }
      onOpenLibrary={(documentId, sourceId) =>
        void navigate({
          to: '/library',
          search: { document: documentId, source: sourceId }
        })
      }
      onCrawlSource={(sourceId) => void sources.crawl(sourceId)}
    />
  )
}
