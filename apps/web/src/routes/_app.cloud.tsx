import { createFileRoute } from '@tanstack/react-router'
import { CloudPage } from '@/pages/CloudPage'
import { parseDocumentSearch, type DocumentSearch } from '@/routing'

export const Route = createFileRoute('/_app/cloud')({
  validateSearch: (search: Record<string, unknown>): DocumentSearch => parseDocumentSearch(search),
  component: CloudPage
})
