import { createFileRoute } from '@tanstack/react-router'
import { AdminBrowserPage } from '@/pages/admin/AdminBrowserPage'

export const Route = createFileRoute('/admin/browser')({
  component: AdminBrowserPage
})
