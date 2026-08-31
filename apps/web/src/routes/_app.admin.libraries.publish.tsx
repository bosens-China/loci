import { createFileRoute } from '@tanstack/react-router'
import { AdminPublishPage } from '@/pages/admin/AdminPublishPage'

export const Route = createFileRoute('/_app/admin/libraries/publish')({
  component: AdminPublishPage
})
