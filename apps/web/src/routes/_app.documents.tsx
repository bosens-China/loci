import { createFileRoute } from '@tanstack/react-router'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { parseDocumentSearch, type DocumentSearch } from '@/routing'

export const Route = createFileRoute('/_app/documents')({
  validateSearch: (search: Record<string, unknown>): DocumentSearch => parseDocumentSearch(search),
  component: DocumentsPage
})
