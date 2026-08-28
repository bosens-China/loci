import { createFileRoute } from '@tanstack/react-router'
import { AdminPublishPage } from '@/pages/admin/AdminPublishPage'

export const Route = createFileRoute('/admin/libraries/publish')({
  validateSearch: (search: Record<string, unknown>) => ({
    source: typeof search.source === 'string' ? search.source : undefined
  }),
  component: AdminLibrariesPublishRoute
})

function AdminLibrariesPublishRoute(): React.JSX.Element {
  const { source } = Route.useSearch()
  return <AdminPublishPage sourceId={source} />
}
