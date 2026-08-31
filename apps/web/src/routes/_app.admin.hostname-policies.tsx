import { createFileRoute } from '@tanstack/react-router'
import { AdminHostnamePoliciesPage } from '@/pages/admin/AdminHostnamePoliciesPage'

export const Route = createFileRoute('/_app/admin/hostname-policies')({
  component: AdminHostnamePoliciesPage
})
