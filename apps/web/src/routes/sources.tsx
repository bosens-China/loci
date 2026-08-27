import { createFileRoute, redirect } from '@tanstack/react-router'
import { canonicalDocumentSearch, parseDocumentSearch } from '@/routing'

export const Route = createFileRoute('/sources')({
  validateSearch: parseDocumentSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/documents',
      search: canonicalDocumentSearch(search),
      replace: true
    })
  }
})
