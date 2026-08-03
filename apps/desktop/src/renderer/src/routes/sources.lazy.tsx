import { createLazyRoute, useNavigate } from '@tanstack/react-router'
import SourcesPage from '../components/SourcesPage'
import type { SourcesTab } from '../components/SourcesPage'
import { useSources } from '../hooks/useSources'

export const Route = createLazyRoute('/sources')({
  component: SourcesRoute
})

function SourcesRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const sources = useSources()
  const search = Route.useSearch()
  const activeTab: SourcesTab = search.tab ?? 'sources'
  const localSources = sources.sources.filter((source) => !source.cloud)

  return (
    <SourcesPage
      sources={localSources}
      loading={sources.loading}
      error={sources.error}
      onRetry={() => void sources.reload()}
      onCreateSource={sources.create}
      onUpdateSource={sources.update}
      onCrawlSource={sources.crawl}
      onOpenLibrary={(sourceId) =>
        void navigate({ to: '/library', search: { source: sourceId, document: undefined } })
      }
      onDeleteSource={sources.remove}
      activeTab={activeTab}
      onTabChange={(tab) =>
        void navigate({
          to: '/sources',
          search: { tab: tab === 'schedules' ? tab : undefined },
          replace: true
        })
      }
    />
  )
}
