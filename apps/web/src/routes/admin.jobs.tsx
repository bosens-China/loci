import { createFileRoute } from '@tanstack/react-router'
import { AdminJobsPage } from '@/pages/admin/AdminJobsPage'

export const Route = createFileRoute('/admin/jobs')({
  component: AdminJobsPage
})
