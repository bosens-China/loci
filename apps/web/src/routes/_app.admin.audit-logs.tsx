import { createFileRoute } from '@tanstack/react-router'
import { AdminAuditLogsPage } from '@/pages/admin/AdminAuditLogsPage'

export const Route = createFileRoute('/_app/admin/audit-logs')({ component: AdminAuditLogsPage })
