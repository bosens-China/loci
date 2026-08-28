import { createFileRoute } from '@tanstack/react-router'
import { AdminLibrariesPage } from '@/pages/admin/AdminLibrariesPage'

export const Route = createFileRoute('/admin/libraries/')({
  component: AdminLibrariesPage
})
