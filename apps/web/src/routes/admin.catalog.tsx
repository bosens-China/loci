import { createFileRoute } from '@tanstack/react-router'
import { AdminCatalogPage } from '@/pages/admin/AdminCatalogPage'

export const Route = createFileRoute('/admin/catalog')({
  component: AdminCatalogPage
})
