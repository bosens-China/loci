import { createFileRoute } from '@tanstack/react-router'
import { AdminPublishPage } from '@/pages/admin/AdminPublishPage'

export const Route = createFileRoute('/admin/publish')({
  component: AdminPublishPage
})
