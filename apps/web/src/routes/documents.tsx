import { createFileRoute, redirect } from '@tanstack/react-router'
import { DocumentsPageLoading } from '@/components/PageLoading'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { canonicalDocumentSearch, parseDocumentSearch } from '@/routing'

export const Route = createFileRoute('/documents')({
  validateSearch: parseDocumentSearch,
  beforeLoad: ({ search }) => {
    if (!search.document) return
    throw redirect({
      to: '/documents',
      search: canonicalDocumentSearch(search),
      replace: true
    })
  },
  pendingComponent: DocumentsPageLoading,
  component: DocumentsPage
})
