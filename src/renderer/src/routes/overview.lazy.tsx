import { createLazyRoute, useNavigate } from '@tanstack/react-router'
import OverviewPage from '@renderer/components/OverviewPage'
import { useDocuments } from '@renderer/hooks/useDocuments'
import { useSources } from '@renderer/hooks/useSources'

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
      onOpenSources={() => void navigate({ to: '/sources' })}
    />
  )
}
