import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/sources')({
  beforeLoad: () => {
    throw redirect({ to: '/documents' })
  }
})
