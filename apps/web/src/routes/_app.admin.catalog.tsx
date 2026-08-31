import { createFileRoute } from '@tanstack/react-router'
import { AdminCatalogPage } from '@/pages/admin/AdminCatalogPage'

export const Route = createFileRoute('/_app/admin/catalog')({ component: AdminCatalogPage })
