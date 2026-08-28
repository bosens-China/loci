import { createFileRoute } from '@tanstack/react-router'
import { AdminHostnamePoliciesPage } from '@/pages/admin/AdminHostnamePoliciesPage'

export const Route = createFileRoute('/admin/hostname-policies')({
  component: AdminHostnamePoliciesPage
})
