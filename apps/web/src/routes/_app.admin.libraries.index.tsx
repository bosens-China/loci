import { createFileRoute } from '@tanstack/react-router'
import { AdminLibrariesPage } from '@/pages/admin/AdminLibrariesPage'

export const Route = createFileRoute('/_app/admin/libraries/')({ component: AdminLibrariesPage })
