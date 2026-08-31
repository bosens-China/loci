import { createFileRoute } from '@tanstack/react-router'
import { AdminJobsPage } from '@/pages/admin/AdminJobsPage'

export const Route = createFileRoute('/_app/admin/jobs')({ component: AdminJobsPage })
