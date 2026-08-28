import { createFileRoute } from '@tanstack/react-router'
import { AdminAuditLogsPage } from '@/pages/admin/AdminAuditLogsPage'

export const Route = createFileRoute('/admin/audit-logs')({
  component: AdminAuditLogsPage
})
