import { createFileRoute } from '@tanstack/react-router'
import { AdminOverviewPage } from '@/pages/admin/AdminOverviewPage'

export const Route = createFileRoute('/admin/')({
  component: AdminOverviewPage
})
