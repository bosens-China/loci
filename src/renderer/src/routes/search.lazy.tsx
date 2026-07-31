import { createLazyRoute, useNavigate } from '@tanstack/react-router'
import SearchPage from '@renderer/components/SearchPage'

export const Route = createLazyRoute('/search')({
  component: SearchRoute
})

function SearchRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const search = Route.useSearch()

  return (
    <SearchPage
      initialQuery={search.query ?? ''}
      onSearch={(query) => window.api.searchDocuments(query)}
      onOpenDocument={(document) =>
        void navigate({
          to: '/library',
          search: { source: document.sourceId, document: document.id }
        })
      }
    />
  )
}
